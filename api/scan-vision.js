/**
 * FiTrack — Groq Vision : identifie un produit depuis un frame caméra
 * Utilisé comme fallback quand le scan code-barres échoue après 5s.
 *
 * POST { image: "base64...", mime: "image/jpeg" }
 * → { name, brand, calories, isFood }
 */

export const config = { runtime: "edge" };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const SUPABASE_URL = "https://wszhbpsuujcgjnvvtgfv.supabase.co";
const ALLOWED_ORIGINS = [
  "https://fitrack-v4.vercel.app",
  "https://fitrack-swart.vercel.app",
];

export default async function handler(request) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(allowedOrigin) });
  }
  if (request.method !== "POST") {
    return jsonError("Méthode non autorisée", 405, allowedOrigin);
  }

  // Auth
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return jsonError("Authentification requise", 401, allowedOrigin);

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonError("Configuration serveur manquante", 500, allowedOrigin);

  let userResp;
  try {
    userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: serviceKey },
    });
  } catch (e) {
    return jsonError("Erreur de vérification de session", 500, allowedOrigin);
  }
  if (!userResp.ok) return jsonError("Session invalide", 401, allowedOrigin);

  // Body
  let body;
  try { body = await request.json(); } catch { return jsonError("Corps JSON invalide", 400, allowedOrigin); }

  const { image, mime } = body;
  if (!image || typeof image !== "string" || image.length < 100) {
    return jsonError("Image manquante ou invalide", 400, allowedOrigin);
  }
  const safeMime = (mime === "image/png" || mime === "image/webp") ? mime : "image/jpeg";

  const groqKey = (process.env.GROQ_API_KEY || "").trim();
  if (!groqKey) return jsonError("Configuration Groq manquante", 500, allowedOrigin);

  // Appel Groq Vision
  let groqResp;
  try {
    groqResp = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${safeMime};base64,${image}` },
              },
              {
                type: "text",
                text: `Identify the food product or cosmetic product visible in this image.
Reply ONLY with this exact format (no explanation, no extra text):
NAME|BRAND|CALORIES|PROTEIN|CARBS|FAT|TYPE

Rules:
- NAME: product name in French (or original if unknown in French)
- BRAND: brand name, or empty if not visible
- CALORIES: estimated kcal per 100g as integer, or 0 if not food
- PROTEIN: estimated protein grams per 100g as integer, or 0 if not food
- CARBS: estimated carbohydrate grams per 100g as integer, or 0 if not food
- FAT: estimated fat grams per 100g as integer, or 0 if not food
- TYPE: "food" or "cosmetic" or "unknown"

Example: Yaourt nature|Danone|59|4|5|3|food
Example: Crème hydratante|Nivea|0|0|0|0|cosmetic`,
              },
            ],
          },
        ],
        max_tokens: 80,
        temperature: 0.1,
      }),
    });
  } catch (e) {
    return jsonError("Erreur lors de l'appel à Groq", 500, allowedOrigin);
  }

  const raw = await groqResp.json().catch(() => null);
  if (!groqResp.ok || !raw) {
    return jsonError("Réponse Groq invalide", 502, allowedOrigin);
  }

  const text = (
    raw.choices &&
    raw.choices[0] &&
    raw.choices[0].message &&
    raw.choices[0].message.content
  ) || "";

  const parts = text.trim().split("|");
  if (parts.length < 4) {
    return jsonError("Produit non identifié", 404, allowedOrigin);
  }

  // Nouveau format à 7 champs (avec macros) ; tolère l'ancien à 4 champs
  const name = parts[0];
  const brand = parts[1];
  const calories = parseInt(parts[2]) || 0;
  const hasMacros = parts.length >= 7;
  const protein = hasMacros ? parseInt(parts[3]) || 0 : 0;
  const carbs = hasMacros ? parseInt(parts[4]) || 0 : 0;
  const fat = hasMacros ? parseInt(parts[5]) || 0 : 0;
  const type = parts[parts.length - 1];
  const isFood = type.trim().toLowerCase() === "food";

  return new Response(
    JSON.stringify({ name: name.trim(), brand: brand.trim(), calories, protein, carbs, fat, isFood }),
    { status: 200, headers: { "content-type": "application/json", ...corsHeaders(allowedOrigin) } }
  );
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonError(message, status, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

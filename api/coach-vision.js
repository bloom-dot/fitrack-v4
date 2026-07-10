/**
 * FiTrack — Conseil IA du Coach Mouvement (analyse auto de fin de série)
 * Reçoit une image de la pire rep + le contexte de la série, renvoie UN
 * conseil technique court en français, lu ensuite par la synthèse vocale.
 *
 * POST { image: "base64...", exercise, reps, avgScore, worstScore }
 * → { tip }
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

  const { image, exercise, reps, avgScore, worstScore } = body;
  if (!image || typeof image !== "string" || image.length < 100) {
    return jsonError("Image manquante ou invalide", 400, allowedOrigin);
  }
  // Plafond de taille (base64) — évite l'envoi de payloads géants à Groq (coût/DoS)
  if (image.length > 1500000) {
    return jsonError("Image trop volumineuse", 413, allowedOrigin);
  }
  const ex = String(exercise || "exercice").slice(0, 60);
  const nReps = parseInt(reps) || 0;
  const avg = parseInt(avgScore) || 0;
  const worst = parseInt(worstScore) || 0;

  const groqKey = (process.env.GROQ_API_KEY || "").trim();
  if (!groqKey) return jsonError("Configuration Groq manquante", 500, allowedOrigin);

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
                image_url: { url: `data:image/jpeg;base64,${image}` },
              },
              {
                type: "text",
                text: `Tu es un coach de musculation. Cette image montre la répétition la moins bien notée d'une série de ${ex} (${nReps} reps, score technique moyen ${avg}/100, pire rep ${worst}/100 — mesuré par angles articulaires).
Analyse la posture visible et donne UN SEUL conseil technique concret pour corriger le défaut principal.
Règles strictes :
- Français, tutoiement, ton direct de coach
- 25 mots MAXIMUM, une seule phrase
- Pas de préambule, pas de "je vois que", pas d'émojis
- Si la personne n'est pas clairement visible, réponds exactement : NON_VISIBLE`,
              },
            ],
          },
        ],
        max_tokens: 60,
        temperature: 0.3,
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

  const tip = text.trim().replace(/^["'«\s]+|["'»\s]+$/g, "");
  if (!tip || tip.indexOf("NON_VISIBLE") !== -1) {
    return jsonError("Personne non visible", 404, allowedOrigin);
  }

  return new Response(
    JSON.stringify({ tip: tip.slice(0, 220) }),
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

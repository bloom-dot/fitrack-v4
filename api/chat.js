/**
 * FiTrack - Fonction serverless Vercel pour FitAI
 *
 * Rôle : recevoir les messages du chat depuis l'app, ajouter la clé API
 * Anthropic (stockée comme variable d'environnement Vercel, jamais
 * envoyée au navigateur) et relayer la requête vers Anthropic.
 *
 * URL une fois déployé : https://<ton-projet>.vercel.app/api/chat
 *
 * La clé API est configurée dans Vercel : Project Settings > Environment
 * Variables > ANTHROPIC_API_KEY (jamais écrite dans le code).
 */

export const config = { runtime: "edge" };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 1024;

// Limite de messages par requête (anti-abus simple)
const MAX_MESSAGES = 30;

export default async function handler(request) {
  // --- 1. Préflight CORS ---
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  // --- 2. On n'accepte que POST ---
  if (request.method !== "POST") {
    return jsonError("Méthode non autorisée", 405);
  }

  // --- 3. Lire et valider le corps de la requête ---
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Corps JSON invalide", 400);
  }

  const { messages, system } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError("Le champ 'messages' est requis", 400);
  }
  if (messages.length > MAX_MESSAGES) {
    return jsonError("Trop de messages dans la conversation", 400);
  }
  for (const m of messages) {
    if (!m || typeof m.content !== "string" || !["user", "assistant"].includes(m.role)) {
      return jsonError("Format de message invalide", 400);
    }
  }

  // --- 4. Appeler l'API Anthropic avec la clé secrète (env var Vercel) ---
  const anthropicResponse = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: typeof system === "string" ? system.slice(0, 4000) : undefined,
      messages,
    }),
  });

  const data = await anthropicResponse.text();

  // --- 5. Renvoyer la réponse à l'app ---
  return new Response(data, {
    status: anthropicResponse.status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

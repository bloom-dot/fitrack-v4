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
 *
 * Sécurité : seul un utilisateur connecté (jeton Supabase valide) peut
 * appeler cette fonction, et chaque utilisateur est limité à un nombre
 * de messages par jour (table "ai_usage" dans Supabase) — ça évite
 * qu'une personne non autorisée ou un script consomme tout le crédit
 * de la clé Anthropic (payante).
 */

export const config = { runtime: "edge" };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 1024;

// Limite de messages par requête (anti-abus simple)
const MAX_MESSAGES = 30;
// Limite de taille par message (caractères) — évite l'envoi de payloads
// énormes qui consommeraient inutilement le crédit API
const MAX_MESSAGE_LENGTH = 4000;
// Origine autorisée à appeler cette API (ton site déployé)
const ALLOWED_ORIGIN = "https://fitrack-v4.vercel.app";
// Nombre maximum de messages FitAI par utilisateur et par jour
const DAILY_LIMIT = 30;

const SUPABASE_URL = "https://wszhbpsuujcgjnvvtgfv.supabase.co";

export default async function handler(request) {
  // --- 1. Préflight CORS ---
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  // --- 2. On n'accepte que POST ---
  if (request.method !== "POST") {
    return jsonError("Méthode non autorisée", 405);
  }

  // --- 3. Vérifie que l'utilisateur est connecté (jeton Supabase) ---
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return jsonError("Authentification requise", 401);
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return jsonError("Configuration serveur manquante", 500);
  }
  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: `Bearer ${token}`, apikey: serviceKey },
  });
  if (!userResp.ok) {
    return jsonError("Session invalide", 401);
  }
  const user = await userResp.json();
  const userId = user.id;
  if (!userId) {
    return jsonError("Utilisateur introuvable", 401);
  }

  // --- 4. Lire et valider le corps de la requête ---
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
    if (m.content.length > MAX_MESSAGE_LENGTH) {
      return jsonError("Message trop long", 400);
    }
  }

  // --- 5. Quota journalier par utilisateur ---
  const today = new Date().toISOString().slice(0, 10);
  const usageHeaders = {
    authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "content-type": "application/json",
  };
  const usageResp = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${userId}&date=eq.${today}&select=count`,
    { headers: usageHeaders }
  );
  let currentCount = 0;
  if (usageResp.ok) {
    const rows = await usageResp.json();
    if (rows.length) currentCount = rows[0].count;
  }
  if (currentCount >= DAILY_LIMIT) {
    return jsonError("Limite quotidienne de messages FitAI atteinte", 429);
  }

  // --- 6. Appeler l'API Anthropic avec la clé secrète (env var Vercel) ---
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

  // --- 7. Met à jour le compteur (best effort, n'échoue pas la requête) ---
  if (anthropicResponse.ok) {
    fetch(`${SUPABASE_URL}/rest/v1/ai_usage`, {
      method: "POST",
      headers: { ...usageHeaders, prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ user_id: userId, date: today, count: currentCount + 1 }),
    }).catch(() => {});
  }

  // --- 8. Renvoyer la réponse à l'app ---
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
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

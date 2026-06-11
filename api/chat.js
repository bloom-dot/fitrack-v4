/**
 * FiTrack - Fonction serverless Vercel pour FitAI
 *
 * Rôle : recevoir les messages du chat depuis l'app, ajouter la clé API
 * Mistral AI (stockée comme variable d'environnement Vercel, jamais
 * envoyée au navigateur) et relayer la requête vers Mistral.
 *
 * Pourquoi Mistral : entreprise française, offre gratuite ("La
 * Plateforme", plan Experiment) sans restriction géographique pour
 * les utilisateurs européens (contrairement à l'API gratuite de
 * Google Gemini, indisponible en UE/Suisse/UK).
 *
 * URL une fois déployé : https://<ton-projet>.vercel.app/api/chat
 *
 * La clé API est configurée dans Vercel : Project Settings > Environment
 * Variables > MISTRAL_API_KEY (jamais écrite dans le code).
 * Pour obtenir une clé gratuite : https://console.mistral.ai
 *
 * Sécurité : seul un utilisateur connecté (jeton Supabase valide) peut
 * appeler cette fonction, et chaque utilisateur est limité à un nombre
 * de messages par jour (table "ai_usage" dans Supabase) — ça évite
 * qu'une personne non autorisée ou un script consomme tout le quota
 * gratuit de la clé Mistral.
 */

export const config = { runtime: "edge" };

const MISTRAL_MODEL = "mistral-small-latest";
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MAX_TOKENS = 1024;

// Limite de messages par requête (anti-abus simple)
const MAX_MESSAGES = 30;
// Limite de taille par message (caractères) — évite l'envoi de payloads
// énormes qui consommeraient inutilement le quota gratuit
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

  try {
  // --- 3. Vérifie que l'utilisateur est connecté (jeton Supabase) ---
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return jsonError("Authentification requise", 401);
  }
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) {
    return jsonError("Configuration serveur manquante (SUPABASE_SERVICE_ROLE_KEY)", 500);
  }
  // Diagnostic : vérifie que la clé et le jeton ne contiennent que des
  // caractères valides pour un header HTTP (souvent un copier-coller
  // ajoute un caractère invisible qui casse fetch())
  const badServiceKeyChars = findInvalidHeaderChars(serviceKey);
  if (badServiceKeyChars.length) {
    return jsonError(
      "SUPABASE_SERVICE_ROLE_KEY contient un caractère invalide (longueur=" +
        serviceKey.length + ", positions=" + JSON.stringify(badServiceKeyChars) + ")",
      500
    );
  }
  const badTokenChars = findInvalidHeaderChars(token);
  if (badTokenChars.length) {
    return jsonError(
      "Le jeton de session contient un caractère invalide (longueur=" +
        token.length + ", positions=" + JSON.stringify(badTokenChars) + ")",
      500
    );
  }

  let userResp;
  try {
    userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: serviceKey },
    });
  } catch (e) {
    return jsonError("Erreur étape 3 (vérif session) : " + (e && e.message ? e.message : String(e)), 500);
  }
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
  let usageResp;
  try {
    usageResp = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${userId}&date=eq.${today}&select=count`,
      { headers: usageHeaders }
    );
  } catch (e) {
    return jsonError("Erreur étape 5 (quota) : " + (e && e.message ? e.message : String(e)), 500);
  }
  let currentCount = 0;
  if (usageResp.ok) {
    const rows = await usageResp.json();
    if (rows.length) currentCount = rows[0].count;
  }
  if (currentCount >= DAILY_LIMIT) {
    return jsonError("QUOTA_INTERNAL", 429);
  }

  // --- 6. Appeler l'API Mistral avec la clé secrète (env var Vercel) ---
  const mistralKey = (process.env.MISTRAL_API_KEY || "").trim();
  if (!mistralKey) {
    return jsonError("Configuration serveur manquante (MISTRAL_API_KEY)", 500);
  }

  const mistralMessages = [];
  if (typeof system === "string" && system.trim()) {
    mistralMessages.push({ role: "system", content: system.slice(0, 4000) });
  }
  for (const m of messages) {
    mistralMessages.push({ role: m.role, content: m.content });
  }

  const mistralBody = {
    model: MISTRAL_MODEL,
    messages: mistralMessages,
    max_tokens: MAX_TOKENS,
  };

  let mistralResponse;
  try {
    mistralResponse = await fetch(MISTRAL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${mistralKey}`,
      },
      body: JSON.stringify(mistralBody),
    });
  } catch (e) {
    return jsonError("Erreur étape 6 (appel Mistral) : " + (e && e.message ? e.message : String(e)), 500);
  }

  const raw = await mistralResponse.json().catch(() => null);

  if (!mistralResponse.ok || !raw) {
    const msg = raw?.message || raw?.error?.message || "Erreur lors de l'appel à l'IA";
    return jsonError(msg, mistralResponse.status || 502);
  }

  const text = raw.choices?.[0]?.message?.content || "";

  if (!text) {
    return jsonError("Réponse vide de l'IA (peut-être bloquée par les filtres de sécurité)", 502);
  }

  // --- 7. Met à jour le compteur (best effort, n'échoue pas la requête) ---
  fetch(`${SUPABASE_URL}/rest/v1/ai_usage`, {
    method: "POST",
    headers: { ...usageHeaders, prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: userId, date: today, count: currentCount + 1 }),
  }).catch(() => {});

  // --- 8. Renvoyer la réponse à l'app, au format attendu côté client ---
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(),
    },
  });
  } catch (e) {
    return jsonError("Erreur serveur : " + (e && e.message ? e.message : String(e)), 500);
  }
}

// Renvoie la liste des positions où le caractère n'est pas un ASCII
// imprimable valide pour un header HTTP (en-têtes : 0x20-0x7E uniquement)
function findInvalidHeaderChars(str) {
  const bad = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) bad.push({ pos: i, code: c });
  }
  return bad;
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

/**
 * FiTrack - Fonction serverless Vercel pour FitAI
 *
 * Proxy vers Mistral AI.
 * Clé API configurée dans Vercel : MISTRAL_API_KEY
 */

export const config = { runtime: "edge" };

const MISTRAL_MODEL = "mistral-small-latest";
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MAX_TOKENS = 3000;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 4000;
const ALLOWED_ORIGIN = "https://fitrack-v4.vercel.app";
const DAILY_LIMIT = 30;
const SUPABASE_URL = "https://wszhbpsuujcgjnvvtgfv.supabase.co";

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (request.method !== "POST") {
    return jsonError("Méthode non autorisée", 405);
  }

  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return jsonError("Authentification requise", 401);

    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!serviceKey) return jsonError("Configuration serveur manquante", 500);

    let userResp;
    try {
      userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { authorization: `Bearer ${token}`, apikey: serviceKey },
      });
    } catch (e) {
      return jsonError("Erreur de vérification de session", 500);
    }
    if (!userResp.ok) return jsonError("Session invalide", 401);
    const user = await userResp.json();
    const userId = user.id;
    if (!userId) return jsonError("Utilisateur introuvable", 401);

    let body;
    try { body = await request.json(); } catch { return jsonError("Corps JSON invalide", 400); }

    const { messages, system } = body;
    if (!Array.isArray(messages) || messages.length === 0) return jsonError("Le champ 'messages' est requis", 400);
    if (messages.length > MAX_MESSAGES) return jsonError("Trop de messages", 400);
    for (const m of messages) {
      if (!m || typeof m.content !== "string" || !["user", "assistant"].includes(m.role)) return jsonError("Format de message invalide", 400);
      if (m.content.length > MAX_MESSAGE_LENGTH) return jsonError("Message trop long", 400);
    }

    const today = new Date().toISOString().slice(0, 10);
    const usageHeaders = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "content-type": "application/json" };

    // Vérification + incrément atomiques via procédure stockée.
    // Élimine la race condition check/increment de l'ancienne implémentation.
    let usageResult;
    try {
      const usageResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_ai_usage`, {
        method: "POST",
        headers: usageHeaders,
        body: JSON.stringify({ p_user_id: userId, p_date: today, p_limit: DAILY_LIMIT }),
      });
      usageResult = usageResp.ok ? await usageResp.json() : null;
    } catch (e) {
      return jsonError("Erreur serveur temporaire", 500);
    }

    if (!usageResult || !usageResult.allowed) {
      return new Response(JSON.stringify({ error: "QUOTA_INTERNAL", remaining: 0 }), {
        status: 429, headers: { "content-type": "application/json", ...corsHeaders() },
      });
    }
    const newCount = usageResult.count;

    const mistralKey = (process.env.MISTRAL_API_KEY || "").trim();
    if (!mistralKey) return jsonError("Configuration serveur manquante (MISTRAL_API_KEY)", 500);

    var mistralMessages = [];
    if (typeof system === "string" && system.trim()) {
      mistralMessages.push({ role: "system", content: system.slice(0, 4000) });
    }
    for (var i = 0; i < messages.length; i++) {
      mistralMessages.push({ role: messages[i].role, content: messages[i].content });
    }

    let mistralResponse;
    try {
      mistralResponse = await fetch(MISTRAL_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${mistralKey}` },
        body: JSON.stringify({ model: MISTRAL_MODEL, messages: mistralMessages, max_tokens: MAX_TOKENS }),
      });
    } catch (e) {
      return jsonError("Erreur lors de l'appel à l'IA", 500);
    }

    const raw = await mistralResponse.json().catch(function() { return null; });
    if (!mistralResponse.ok || !raw) {
      var msg = (raw && raw.message) || (raw && raw.error && raw.error.message) || "Erreur lors de l'appel à l'IA";
      return jsonError(msg, mistralResponse.status || 502);
    }

    var text = (raw.choices && raw.choices[0] && raw.choices[0].message && raw.choices[0].message.content) || "";
    if (!text) return jsonError("Réponse vide de l'IA", 502);

    return new Response(JSON.stringify({ content: [{ type: "text", text: text }], remaining: Math.max(0, DAILY_LIMIT - newCount) }), {
      status: 200,
      headers: { "content-type": "application/json", ...corsHeaders() },
    });
  } catch (e) {
    return jsonError("Erreur serveur interne", 500);
  }
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
    status, headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

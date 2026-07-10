/**
 * FiTrack - Enregistrement / suppression d'une souscription Push
 *
 * POST /api/push-subscribe  { subscription, action: "subscribe"|"unsubscribe" }
 * Authentification : Authorization: Bearer <supabase_access_token>
 *
 * La subscription object (endpoint + keys) est stockée dans la table
 * push_subscriptions de Supabase, associée à l'utilisateur connecté.
 */

export const config = { runtime: "edge" };

const SUPABASE_URL = "https://wszhbpsuujcgjnvvtgfv.supabase.co";
const ALLOWED_ORIGIN = "https://fitrack-v4.vercel.app";

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (request.method !== "POST") return jsonError("Méthode non autorisée", 405);

  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonError("Non authentifié", 401);

  const serviceKey = (typeof process !== "undefined" && process.env?.SUPABASE_SERVICE_ROLE_KEY) || "";
  if (!serviceKey) return jsonError("Config manquante", 500);

  // Vérifier l'identité de l'utilisateur
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: serviceKey },
  });
  if (!userRes.ok) return jsonError("Token invalide", 401);
  const userData = await userRes.json();
  const userId = userData.id;

  const body = await request.json().catch(() => null);
  if (!body) return jsonError("Corps JSON invalide", 400);
  const { subscription, action } = body;

  if (action !== "subscribe" && action !== "unsubscribe") return jsonError("Action invalide", 400);

  if (action === "unsubscribe") {
    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${userId}&endpoint=eq.${encodeURIComponent(subscription?.endpoint || "")}`, {
      method: "DELETE",
      headers: supabaseHeaders(serviceKey),
    });
    return jsonOk({ ok: true });
  }

  if (!subscription?.endpoint) return jsonError("Subscription invalide", 400);

  // Upsert (remplace si même endpoint)
  await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions`, {
    method: "POST",
    headers: { ...supabaseHeaders(serviceKey), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys?.p256dh,
      auth_key: subscription.keys?.auth,
    }),
  });

  return jsonOk({ ok: true });
}

function supabaseHeaders(serviceKey) {
  return {
    "Content-Type": "application/json",
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonOk(data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

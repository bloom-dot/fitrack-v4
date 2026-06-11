/**
 * FiTrack - Fonction serverless Vercel pour supprimer un compte
 *
 * Rôle : recevoir le jeton de connexion (access token) de l'utilisateur,
 * vérifier son identité, puis supprimer définitivement son compte
 * (auth.users) et ses photos de progression dans Supabase Storage.
 *
 * Grâce aux contraintes "on delete cascade" du schéma, supprimer le
 * compte auth.users supprime automatiquement : profil, séances,
 * records, mensurations, badges et streak.
 *
 * Nécessite la variable d'environnement Vercel SUPABASE_SERVICE_ROLE_KEY
 * (clé secrète "service_role", jamais envoyée au navigateur) :
 * Project Settings > Environment Variables > SUPABASE_SERVICE_ROLE_KEY
 */

export const config = { runtime: "edge" };

const SUPABASE_URL = "https://wszhbpsuujcgjnvvtgfv.supabase.co";
const ALLOWED_ORIGIN = "https://fitrack-v4.vercel.app";

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (request.method !== "POST") {
    return jsonError("Méthode non autorisée", 405);
  }

  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return jsonError("Authentification requise", 401);
  }

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) {
    return jsonError("Configuration serveur manquante", 500);
  }

  // 1. Vérifie le token et récupère l'utilisateur
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

  // 2. Supprime les photos de progression de l'utilisateur (Storage)
  try {
    const listResp = await fetch(`${SUPABASE_URL}/storage/v1/object/list/progress-photos`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ prefix: `${userId}/` }),
    });
    if (listResp.ok) {
      const files = await listResp.json();
      if (Array.isArray(files) && files.length) {
        const prefixes = files.map((f) => `${userId}/${f.name}`);
        await fetch(`${SUPABASE_URL}/storage/v1/object/progress-photos`, {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({ prefixes }),
        });
      }
    }
  } catch {
    // On continue même si la suppression des photos échoue partiellement
  }

  // 3. Supprime le compte (cascade vers toutes les tables liées)
  const delResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
  });
  if (!delResp.ok) {
    return jsonError("Échec de la suppression du compte", 500);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", ...corsHeaders() },
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

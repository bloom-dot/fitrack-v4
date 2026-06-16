/**
 * FiTrack - API Défis entre utilisateurs
 *
 * GET    /api/challenges?action=list&token=...          → défis de l'utilisateur + publics
 * GET    /api/challenges?action=get&code=XXX&token=...  → détail + classement d'un défi
 * POST   /api/challenges  { action:"create", title, target_sessions, duration_days, is_public }
 * POST   /api/challenges  { action:"join", code }
 * POST   /api/challenges  { action:"leave", challenge_id }
 */

export const config = { runtime: "edge" };

const SUPABASE_URL = "https://wszhbpsuujcgjnvvtgfv.supabase.co";
const ALLOWED_ORIGIN = "https://fitrack-v4.vercel.app";

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

  const serviceKey = (typeof process !== "undefined" && process.env?.SUPABASE_SERVICE_ROLE_KEY) || "";
  if (!serviceKey) return jsonError("Config manquante", 500);

  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonError("Non authentifié", 401);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: serviceKey },
  });
  if (!userRes.ok) return jsonError("Token invalide", 401);
  const { id: userId, email } = await userRes.json();
  const displayName = email?.split("@")[0] || "Anonyme";

  const sh = supabaseHeaders(serviceKey);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (action === "list") {
      // Défis rejoints par l'utilisateur
      const [joinedRes, publicRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/challenge_participants?select=challenge_id,joined_at,challenges(*)&user_id=eq.${userId}&order=joined_at.desc&limit=20`, { headers: sh }),
        fetch(`${SUPABASE_URL}/rest/v1/challenges?is_public=eq.true&order=created_at.desc&limit=20`, { headers: sh }),
      ]);
      const joined = joinedRes.ok ? await joinedRes.json() : [];
      const publicC = publicRes.ok ? await publicRes.json() : [];
      const joinedIds = new Set(joined.map((j) => j.challenge_id));
      const discover = publicC.filter((c) => !joinedIds.has(c.id));
      return jsonOk({ joined: joined.map((j) => ({ ...j.challenges, joined_at: j.joined_at })), discover });
    }

    if (action === "get") {
      const code = url.searchParams.get("code");
      if (!code) return jsonError("Code requis", 400);

      const cRes = await fetch(`${SUPABASE_URL}/rest/v1/challenges?code=eq.${encodeURIComponent(code.toUpperCase())}&limit=1`, { headers: sh });
      const [challenge] = cRes.ok ? await cRes.json() : [];
      if (!challenge) return jsonError("Défi introuvable", 404);

      // Participants avec leur progression (séances pendant la période)
      const partRes = await fetch(`${SUPABASE_URL}/rest/v1/challenge_participants?challenge_id=eq.${challenge.id}`, { headers: sh });
      const participants = partRes.ok ? await partRes.json() : [];

      // Pour chaque participant, compter les séances dans la période du défi
      const leaderboard = await Promise.all(
        participants.map(async (p) => {
          const sessRes = await fetch(
            `${SUPABASE_URL}/rest/v1/sessions?user_id=eq.${p.user_id}&date=gte.${challenge.start_date}&date=lte.${challenge.end_date}&select=id`,
            { headers: sh }
          );
          const sessions = sessRes.ok ? await sessRes.json() : [];
          return { user_id: p.user_id, sessions: sessions.length, joined_at: p.joined_at };
        })
      );
      leaderboard.sort((a, b) => b.sessions - a.sessions);

      // Récupérer les noms depuis profiles
      const profileIds = leaderboard.map((l) => l.user_id);
      let profiles = [];
      if (profileIds.length) {
        const pRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=in.(${profileIds.join(",")})&select=id,name`,
          { headers: sh }
        );
        profiles = pRes.ok ? await pRes.json() : [];
      }
      const nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.name || "Anonyme"]));

      const isParticipant = participants.some((p) => p.user_id === userId);
      return jsonOk({
        challenge,
        leaderboard: leaderboard.map((l, i) => ({
          rank: i + 1,
          user_id: l.user_id,
          name: nameMap[l.user_id] || "Anonyme",
          sessions: l.sessions,
          is_me: l.user_id === userId,
        })),
        is_participant: isParticipant,
        my_sessions: leaderboard.find((l) => l.user_id === userId)?.sessions || 0,
      });
    }

    return jsonError("Action inconnue", 400);
  }

  if (request.method === "POST") {
    const body = await request.json();
    const { action } = body;

    if (action === "create") {
      const { title, target_sessions, duration_days, is_public } = body;
      if (!title || !target_sessions || !duration_days) return jsonError("Champs manquants", 400);

      // Créer le défi
      const cRes = await fetch(`${SUPABASE_URL}/rest/v1/challenges`, {
        method: "POST",
        headers: { ...sh, Prefer: "return=representation" },
        body: JSON.stringify({
          creator_id: userId,
          title,
          target_sessions: parseInt(target_sessions),
          duration_days: parseInt(duration_days),
          is_public: !!is_public,
          start_date: new Date().toISOString().slice(0, 10),
        }),
      });
      const [challenge] = cRes.ok ? await cRes.json() : [];
      if (!challenge) return jsonError("Erreur création défi", 500);

      // Rejoindre automatiquement son propre défi
      await fetch(`${SUPABASE_URL}/rest/v1/challenge_participants`, {
        method: "POST",
        headers: sh,
        body: JSON.stringify({ challenge_id: challenge.id, user_id: userId }),
      });

      return jsonOk({ challenge });
    }

    if (action === "join") {
      const { code } = body;
      if (!code) return jsonError("Code requis", 400);
      const cRes = await fetch(`${SUPABASE_URL}/rest/v1/challenges?code=eq.${encodeURIComponent(code.toUpperCase())}&limit=1`, { headers: sh });
      const [challenge] = cRes.ok ? await cRes.json() : [];
      if (!challenge) return jsonError("Défi introuvable", 404);

      await fetch(`${SUPABASE_URL}/rest/v1/challenge_participants`, {
        method: "POST",
        headers: { ...sh, Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({ challenge_id: challenge.id, user_id: userId }),
      });
      return jsonOk({ challenge });
    }

    if (action === "leave") {
      const { challenge_id } = body;
      await fetch(`${SUPABASE_URL}/rest/v1/challenge_participants?challenge_id=eq.${challenge_id}&user_id=eq.${userId}`, {
        method: "DELETE",
        headers: sh,
      });
      return jsonOk({ ok: true });
    }

    return jsonError("Action inconnue", 400);
  }

  return jsonError("Méthode non autorisée", 405);
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
function jsonOk(data) {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}

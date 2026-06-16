/**
 * FiTrack - API Défis de performance
 *
 * GET  /api/challenges?action=leaderboard&type_id=...&week_key=...&friend_code=...
 *   → classement des scores pour un défi donné
 * GET  /api/challenges?action=my_score&type_id=...&week_key=...&friend_code=...
 *   → meilleur score perso
 *
 * POST /api/challenges  { action:"log", type_id, week_key, score, friend_code? }
 *   → enregistre / améliore le score
 * POST /api/challenges  { action:"create_friend", type_id, week_key }
 *   → crée un défi ami, retourne un code
 * POST /api/challenges  { action:"get_friend", code }
 *   → info défi ami (type_id, week_key) + classement
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
  const { id: userId } = await userRes.json();

  const sh = supabaseHeaders(serviceKey);

  // ── GET ──────────────────────────────────────────────────────────
  if (request.method === "GET") {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const typeId = url.searchParams.get("type_id") || "";
    const weekKey = url.searchParams.get("week_key") || "";
    const friendCode = url.searchParams.get("friend_code") || null;

    if (action === "leaderboard") {
      let qs = `challenge_type_id=eq.${encodeURIComponent(typeId)}&week_key=eq.${encodeURIComponent(weekKey)}&order=score.desc&limit=50`;
      if (friendCode) qs += `&friend_code=eq.${encodeURIComponent(friendCode)}`;
      else qs += `&friend_code=is.null`;

      const rRes = await fetch(`${SUPABASE_URL}/rest/v1/challenge_results?${qs}`, { headers: sh });
      const results = rRes.ok ? await rRes.json() : [];

      // Récupérer les noms
      const userIds = [...new Set(results.map((r) => r.user_id))];
      let names = {};
      if (userIds.length) {
        const pRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=in.(${userIds.join(",")})&select=id,name`, { headers: sh });
        const profiles = pRes.ok ? await pRes.json() : [];
        profiles.forEach((p) => { names[p.id] = p.name || "Anonyme"; });
      }

      return jsonOk(results.map((r, i) => ({
        rank: i + 1,
        user_id: r.user_id,
        name: names[r.user_id] || "Anonyme",
        score: r.score,
        is_me: r.user_id === userId,
        logged_at: r.logged_at,
      })));
    }

    if (action === "get_friend") {
      const code = url.searchParams.get("code") || "";
      const fcRes = await fetch(`${SUPABASE_URL}/rest/v1/friend_challenges?code=eq.${encodeURIComponent(code.toUpperCase())}&limit=1`, { headers: sh });
      const [fc] = fcRes.ok ? await fcRes.json() : [];
      if (!fc) return jsonError("Défi introuvable", 404);

      // Classement
      const rRes = await fetch(`${SUPABASE_URL}/rest/v1/challenge_results?challenge_type_id=eq.${encodeURIComponent(fc.challenge_type_id)}&week_key=eq.${encodeURIComponent(fc.week_key)}&friend_code=eq.${encodeURIComponent(code.toUpperCase())}&order=score.desc&limit=20`, { headers: sh });
      const results = rRes.ok ? await rRes.json() : [];
      const userIds = [...new Set(results.map((r) => r.user_id))];
      let names = {};
      if (userIds.length) {
        const pRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=in.(${userIds.join(",")})&select=id,name`, { headers: sh });
        const profiles = pRes.ok ? await pRes.json() : [];
        profiles.forEach((p) => { names[p.id] = p.name || "Anonyme"; });
      }
      return jsonOk({
        friend_challenge: fc,
        leaderboard: results.map((r, i) => ({
          rank: i + 1, user_id: r.user_id, name: names[r.user_id] || "Anonyme",
          score: r.score, is_me: r.user_id === userId,
        })),
      });
    }

    return jsonError("Action inconnue", 400);
  }

  // ── POST ─────────────────────────────────────────────────────────
  if (request.method === "POST") {
    const body = await request.json();
    const { action } = body;

    if (action === "log") {
      const { type_id, week_key, score, friend_code } = body;
      if (!type_id || !week_key || score == null) return jsonError("Champs manquants", 400);
      const scoreNum = parseFloat(score);
      if (isNaN(scoreNum) || scoreNum < 0) return jsonError("Score invalide", 400);

      // Vérifier si un score existe déjà — ne mettre à jour que si meilleur
      let qs = `user_id=eq.${userId}&challenge_type_id=eq.${encodeURIComponent(type_id)}&week_key=eq.${encodeURIComponent(week_key)}`;
      if (friend_code) qs += `&friend_code=eq.${encodeURIComponent(friend_code.toUpperCase())}`;
      else qs += `&friend_code=is.null`;
      const existing = await fetch(`${SUPABASE_URL}/rest/v1/challenge_results?${qs}&limit=1`, { headers: sh });
      const [prev] = existing.ok ? await existing.json() : [];

      if (prev) {
        if (scoreNum <= prev.score) return jsonOk({ ok: true, improved: false, best: prev.score });
        await fetch(`${SUPABASE_URL}/rest/v1/challenge_results?id=eq.${prev.id}`, {
          method: "PATCH",
          headers: sh,
          body: JSON.stringify({ score: scoreNum, logged_at: new Date().toISOString() }),
        });
        return jsonOk({ ok: true, improved: true, best: scoreNum });
      }

      await fetch(`${SUPABASE_URL}/rest/v1/challenge_results`, {
        method: "POST",
        headers: sh,
        body: JSON.stringify({
          user_id: userId,
          challenge_type_id: type_id,
          week_key,
          score: scoreNum,
          friend_code: friend_code ? friend_code.toUpperCase() : null,
        }),
      });
      return jsonOk({ ok: true, improved: true, best: scoreNum });
    }

    if (action === "create_friend") {
      const { type_id, week_key } = body;
      if (!type_id || !week_key) return jsonError("Champs manquants", 400);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/friend_challenges`, {
        method: "POST",
        headers: { ...sh, Prefer: "return=representation" },
        body: JSON.stringify({ creator_id: userId, challenge_type_id: type_id, week_key }),
      });
      const [fc] = res.ok ? await res.json() : [];
      if (!fc) return jsonError("Erreur création défi", 500);
      return jsonOk({ code: fc.code, expires_at: fc.expires_at });
    }

    return jsonError("Action inconnue", 400);
  }

  return jsonError("Méthode non autorisée", 405);
}

function supabaseHeaders(k) {
  return { "Content-Type": "application/json", apikey: k, Authorization: `Bearer ${k}` };
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
function jsonError(msg, s) {
  return new Response(JSON.stringify({ error: msg }), { status: s, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}

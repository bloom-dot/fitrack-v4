/**
 * FiTrack — Analyse technique détaillée du Coach Mouvement (fin de série)
 *
 * Reçoit l'image de la pire répétition + le contexte chiffré de la série
 * (scores par rep, angles articulaires) et renvoie une analyse STRUCTURÉE
 * en français (défaut principal, correction, cue, point secondaire, positif,
 * gravité). Modèle vision Groq llama-4-maverick en mode JSON.
 *
 * POST {
 *   image, exercise, reps, avgScore, worstScore, bestScore, goodReps,
 *   angleLabel, minAngle, maxAngle, rom
 * }
 * → {
 *   visible: true,
 *   defaut_principal, correction, cue, point_secondaire, positif,
 *   severite: "faible"|"moyenne"|"élevée"
 * }
 */

export const config = { runtime: "edge" };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "meta-llama/llama-4-maverick-17b-128e-instruct";
const SUPABASE_URL = "https://wszhbpsuujcgjnvvtgfv.supabase.co";
const MAX_IMAGE_B64 = 1500000;
const ALLOWED_ORIGINS = [
  "https://fitrack-v4.vercel.app",
  "https://fitrack-swart.vercel.app",
];

const SYSTEM_PROMPT = `Tu es un coach expert en musculation et biomécanique. On te donne la photo de la répétition la MOINS bien notée d'une série, plus des mesures chiffrées (scores par rep et angles articulaires calculés automatiquement).

Analyse la posture réellement visible sur l'image, en la corrélant aux mesures, et renvoie STRICTEMENT un objet JSON valide (aucun texte hors du JSON) :
{
  "visible": true,
  "defaut_principal": "le défaut technique majeur visible, précis et concret",
  "correction": "comment le corriger, action concrète et actionnable",
  "cue": "un repère mental court à se répéter pendant l'effort (max 6 mots)",
  "point_secondaire": "une 2e observation utile (ou \"\" si rien de notable)",
  "positif": "un point réellement bien exécuté à conserver",
  "severite": "faible" | "moyenne" | "élevée"
}

Règles :
- Français, tutoiement, ton de coach direct et bienveillant.
- Sois PRÉCIS et spécifique à l'exercice et aux chiffres fournis (ex : profondeur, dos, alignement genoux, amplitude, tempo). Évite les généralités creuses.
- Chaque champ = 1 phrase claire. Pas d'émojis, pas de markdown.
- "severite" reflète le risque/impact du défaut (technique + blessure).
- Si aucune personne n'est clairement identifiable sur l'image, renvoie exactement : {"visible": false}.`;

export default async function handler(request) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(allowedOrigin) });
  if (request.method !== "POST") return jsonError("Méthode non autorisée", 405, allowedOrigin);

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

  const { image } = body;
  if (!image || typeof image !== "string" || image.length < 100) {
    return jsonError("Image manquante ou invalide", 400, allowedOrigin);
  }
  if (image.length > MAX_IMAGE_B64) {
    return jsonError("Image trop volumineuse", 413, allowedOrigin);
  }

  const ex = String(body.exercise || "exercice").slice(0, 60);
  const nReps = intOr(body.reps, 0);
  const avg = intOr(body.avgScore, 0);
  const worst = intOr(body.worstScore, 0);
  const best = intOr(body.bestScore, 0);
  const good = intOr(body.goodReps, 0);
  const angleLabel = String(body.angleLabel || "principal").slice(0, 40);
  const minA = body.minAngle == null ? null : intOr(body.minAngle, null);
  const maxA = body.maxAngle == null ? null : intOr(body.maxAngle, null);
  const rom = body.rom == null ? null : intOr(body.rom, null);

  const angleTxt =
    minA != null && maxA != null
      ? `Angle « ${angleLabel} » : de ${minA}° à ${maxA}° (amplitude ${rom != null ? rom : maxA - minA}°).`
      : "";

  const userText = `Exercice : ${ex}. Série de ${nReps} reps.
Scores techniques (/100) : moyen ${avg}, meilleure rep ${best}, pire rep ${worst}, reps correctes (≥70) : ${good}/${nReps}.
${angleTxt}
L'image montre la pire répétition. Donne l'analyse JSON demandée.`;

  const groqKey = (process.env.GROQ_API_KEY || "").trim();
  if (!groqKey) return jsonError("Configuration Groq manquante", 500, allowedOrigin);

  let groqResp;
  try {
    groqResp = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
              { type: "text", text: userText },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    return jsonError("Erreur lors de l'appel à Groq", 500, allowedOrigin);
  }

  const raw = await groqResp.json().catch(() => null);
  if (!groqResp.ok || !raw) return jsonError("Réponse Groq invalide", 502, allowedOrigin);

  const content =
    (raw.choices && raw.choices[0] && raw.choices[0].message && raw.choices[0].message.content) || "";
  const parsed = parseJsonLoose(content);
  if (!parsed) return jsonError("Analyse impossible (format IA inattendu)", 502, allowedOrigin);

  if (parsed.visible === false || (!parsed.defaut_principal && !parsed.correction)) {
    return jsonError("Personne non visible", 404, allowedOrigin);
  }

  const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  let sev = clip(parsed.severite, 12).toLowerCase();
  if (!["faible", "moyenne", "élevée", "elevee"].includes(sev)) sev = "moyenne";

  return new Response(
    JSON.stringify({
      visible: true,
      defaut_principal: clip(parsed.defaut_principal, 240),
      correction: clip(parsed.correction, 240),
      cue: clip(parsed.cue, 60),
      point_secondaire: clip(parsed.point_secondaire, 240),
      positif: clip(parsed.positif, 240),
      severite: sev === "elevee" ? "élevée" : sev,
    }),
    { status: 200, headers: { "content-type": "application/json", ...corsHeaders(allowedOrigin) } }
  );
}

function intOr(v, def) {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

function parseJsonLoose(text) {
  if (!text || typeof text !== "string") return null;
  try { return JSON.parse(text); } catch {}
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s !== -1 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch {} }
  return null;
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

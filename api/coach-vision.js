/**
 * FiTrack — Débrief technique complet du Coach Mouvement (analyse différée)
 *
 * Reçoit l'image de la PIRE répétition (+ optionnellement la MEILLEURE) et le
 * contexte chiffré de la série (scores par rep, angles, fatigue), puis renvoie
 * un débrief structuré en français : verdict, points forts, défauts priorisés
 * avec correction et cue, analyse par phase, checklist de la rep parfaite et
 * plan pour la prochaine séance.
 *
 * POST {
 *   image (base64, pire rep), imageBest (base64, meilleure rep, optionnel),
 *   exercise, reps, avgScore, worstScore, bestScore, goodReps, scores[],
 *   angleLabel, minAngle, maxAngle, rom, fatigue
 * }
 * → { visible:true, verdict, note_globale, resume, points_forts[], defauts[],
 *     phases{}, checklist[], plan[] }
 */

export const config = { runtime: "edge" };

// NB : le compte Groq de ce projet n'expose AUCUN modèle vision (vérifié via
// /v1/models : uniquement du texte, de l'audio et du TTS). On passe donc par
// Gemini, qui gère l'image et le JSON structuré nativement.
// gemini-2.5-flash n'est plus ouvert aux nouveaux comptes (404) ;
// gemini-3-flash-preview est validé (vision + JSON) sur cette clé.
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent";
const SUPABASE_URL = "https://wszhbpsuujcgjnvvtgfv.supabase.co";
const MAX_IMAGE_B64 = 1500000;
const ALLOWED_ORIGINS = [
  "https://fitrack-v4.vercel.app",
  "https://fitrack-swart.vercel.app",
];

const SYSTEM_PROMPT = `Tu es un coach expert en musculation et biomécanique. Tu débriefes une série filmée.

On te fournit une ou deux images (la PIRE répétition, et si disponible la MEILLEURE) ainsi que des mesures chiffrées calculées automatiquement (scores par répétition, angles articulaires, fatigue).

Analyse ce qui est RÉELLEMENT visible et renvoie STRICTEMENT un objet JSON valide, sans aucun texte autour :
{
  "visible": true,
  "verdict": "correct" | "à corriger" | "risqué",
  "note_globale": 0-100,
  "resume": "2 phrases : ce qui ressort de la série dans l'ensemble",
  "points_forts": ["ce qui est bien exécuté", "..."],
  "defauts": [
    {
      "titre": "nom court du défaut",
      "impact": "conséquence concrète (perte d'efficacité et/ou risque de blessure)",
      "correction": "comment le corriger, étape par étape, très concret",
      "cue": "repère mental court à se répéter (max 6 mots)",
      "priorite": "haute" | "moyenne" | "basse"
    }
  ],
  "phases": {
    "descente": "ce qui se passe pendant la phase excentrique",
    "bas": "ce qui se passe en position basse / d'étirement",
    "remontee": "ce qui se passe pendant la phase concentrique"
  },
  "checklist": [
    { "critere": "critère d'une répétition parfaite pour CET exercice", "ok": true|false }
  ],
  "plan": ["action précise pour la prochaine séance", "..."]
}

Règles :
- Français, tutoiement, ton de coach direct, exigeant mais bienveillant.
- Sois PRÉCIS et spécifique à l'exercice et aux chiffres (amplitude, profondeur, alignement, tempo, symétrie). Aucune généralité creuse.
- "defauts" : 1 à 3 entrées, triées par priorité décroissante. Si l'exécution est vraiment propre, renvoie un tableau vide.
- "checklist" : 4 à 6 critères de la répétition parfaite, avec ok=false pour ceux qui ne sont pas respectés dans la vidéo.
- "plan" : 2 à 3 actions concrètes (charge, tempo, amplitude, exercice correctif).
- "note_globale" doit rester cohérente avec les scores fournis.
- Pas d'émojis, pas de markdown.
- Si aucune personne n'est clairement identifiable, renvoie exactement : {"visible": false}.`;

export default async function handler(request) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(allowedOrigin) });
  if (request.method !== "POST") return jsonError("Méthode non autorisée", 405, allowedOrigin);

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

  let body;
  try { body = await request.json(); } catch { return jsonError("Corps JSON invalide", 400, allowedOrigin); }

  const { image, imageBest } = body;
  if (!image || typeof image !== "string" || image.length < 100) {
    return jsonError("Image manquante ou invalide", 400, allowedOrigin);
  }
  if (image.length > MAX_IMAGE_B64 || (imageBest && imageBest.length > MAX_IMAGE_B64)) {
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
  const fatigue = body.fatigue == null ? null : intOr(body.fatigue, null);
  const scores = Array.isArray(body.scores)
    ? body.scores.slice(0, 40).map((s) => intOr(s, 0)).join(", ")
    : "";

  const lines = [
    `Exercice : ${ex}. Série de ${nReps} répétitions.`,
    `Scores techniques (/100) : moyen ${avg}, meilleure ${best}, pire ${worst}, reps correctes (>=70) : ${good}/${nReps}.`,
    scores ? `Score de chaque répétition, dans l'ordre : ${scores}.` : "",
    minA != null && maxA != null
      ? `Angle « ${angleLabel} » : de ${minA}° à ${maxA}° (amplitude ${rom != null ? rom : maxA - minA}°).`
      : "",
    fatigue != null
      ? `Évolution de la qualité entre le début et la fin de la série : ${fatigue > 0 ? "+" : ""}${fatigue} points.`
      : "",
    imageBest
      ? "Image 1 = la PIRE répétition. Image 2 = la MEILLEURE répétition (référence de comparaison)."
      : "L'image montre la PIRE répétition de la série.",
    "Donne le débrief JSON demandé.",
  ].filter(Boolean);

  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return jsonError("Configuration Gemini manquante", 500, allowedOrigin);

  const parts = [{ inline_data: { mime_type: "image/jpeg", data: image } }];
  if (imageBest && typeof imageBest === "string" && imageBest.length > 100) {
    parts.push({ inline_data: { mime_type: "image/jpeg", data: imageBest } });
  }
  parts.push({ text: lines.join("\n") });

  let apiResp;
  try {
    apiResp = await fetch(GEMINI_URL + "?key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      }),
    });
  } catch (e) {
    return jsonError("Erreur lors de l'appel à l'IA", 500, allowedOrigin);
  }

  const raw = await apiResp.json().catch(() => null);
  if (!apiResp.ok || !raw) {
    const detail =
      (raw && ((raw.error && raw.error.message) || raw.message)) || `HTTP ${apiResp.status}`;
    console.error("[coach-vision] Gemini KO", apiResp.status, String(detail).slice(0, 300));
    return jsonError("Analyse IA indisponible : " + String(detail).slice(0, 120), 502, allowedOrigin);
  }

  const cand = raw.candidates && raw.candidates[0];
  const text = (cand && cand.content && Array.isArray(cand.content.parts)
    ? cand.content.parts.map((p) => p.text || "").join("")
    : "") || "";
  const parsed = parseJsonLoose(text);
  if (!parsed) {
    console.error("[coach-vision] JSON illisible", String(text).slice(0, 200));
    return jsonError("Analyse impossible (format IA inattendu)", 502, allowedOrigin);
  }
  if (parsed.visible === false) return jsonError("Personne non visible", 404, allowedOrigin);

  return new Response(JSON.stringify(normalize(parsed, avg)), {
    status: 200,
    headers: { "content-type": "application/json", ...corsHeaders(allowedOrigin) },
  });
}

function normalize(p, avgScore) {
  const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const arrStr = (a, n, max) =>
    Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, n)).slice(0, max) : [];

  let verdict = clip(p.verdict, 20).toLowerCase();
  if (!["correct", "à corriger", "a corriger", "risqué", "risque"].includes(verdict)) verdict = "à corriger";
  if (verdict === "a corriger") verdict = "à corriger";
  if (verdict === "risque") verdict = "risqué";

  let note = parseInt(p.note_globale, 10);
  if (isNaN(note) || note < 0 || note > 100) note = avgScore || 0;

  const defauts = (Array.isArray(p.defauts) ? p.defauts : [])
    .filter((d) => d && (d.titre || d.correction))
    .slice(0, 3)
    .map((d) => {
      let pr = clip(d.priorite, 10).toLowerCase();
      if (!["haute", "moyenne", "basse"].includes(pr)) pr = "moyenne";
      return {
        titre: clip(d.titre, 90),
        impact: clip(d.impact, 220),
        correction: clip(d.correction, 320),
        cue: clip(d.cue, 60),
        priorite: pr,
      };
    });

  const checklist = (Array.isArray(p.checklist) ? p.checklist : [])
    .filter((c) => c && c.critere)
    .slice(0, 6)
    .map((c) => ({ critere: clip(c.critere, 120), ok: c.ok === true }));

  const ph = p.phases || {};
  return {
    visible: true,
    verdict,
    note_globale: note,
    resume: clip(p.resume, 320),
    points_forts: arrStr(p.points_forts, 160, 3),
    defauts,
    phases: {
      descente: clip(ph.descente, 220),
      bas: clip(ph.bas, 220),
      remontee: clip(ph.remontee, 220),
    },
    checklist,
    plan: arrStr(p.plan, 180, 3),
  };
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

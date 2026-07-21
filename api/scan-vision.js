/**
 * FiTrack — Analyse nutritionnelle d'une image (style Yazio)
 *
 * Reçoit une photo d'aliment / plat / code-barres et renvoie une estimation
 * nutritionnelle STRICTEMENT au format JSON standardisé (voir SCHÉMA plus bas).
 * Utilise Groq Vision (modèle llama-4-scout) en mode JSON.
 *
 * POST { image: "base64...", mime: "image/jpeg" }
 *   Authorization: Bearer <supabase_access_token>
 *
 * → {
 *     food_name: "Nom en français",
 *     confidence_score: 0.0..1.0,
 *     estimated_weight_g: number,      // poids de la portion visible
 *     calories: number,                // TOTAL pour estimated_weight_g
 *     macros: { carbs_g, protein_g, fat_g },  // TOTAUX pour estimated_weight_g
 *     is_raw_ingredient: boolean,
 *     alternatives: string[],
 *     is_food: boolean                 // champ dérivé (extra, non bloquant)
 *   }
 *
 * NB : Groq a décommissionné les modèles vision "llama-3.2-*-vision-preview".
 * Le modèle vision supporté est meta-llama/llama-4-scout-17b-16e-instruct.
 */

export const config = { runtime: "edge" };

// NB : le compte Groq de ce projet n'expose AUCUN modèle vision (vérifié via
// /v1/models). On passe donc par Gemini, qui gère l'image et le JSON structuré.
// gemini-2.5-flash n'est plus ouvert aux nouveaux comptes (404) ;
// gemini-3-flash-preview est validé (vision + JSON) sur cette clé.
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent";
const SUPABASE_URL = "https://wszhbpsuujcgjnvvtgfv.supabase.co";
const MAX_IMAGE_B64 = 1500000; // ~1,1 Mo — borne le coût/DoS par requête
const ALLOWED_ORIGINS = [
  "https://fitrack-v4.vercel.app",
  "https://fitrack-swart.vercel.app",
];

// Mode "étiquette" : on ne DEVINE plus les valeurs, on LIT le tableau
// nutritionnel imprimé sur l'emballage. C'est la seule façon d'être exact quand
// le produit est absent de la base ou que ses données y sont fausses.
const LABEL_PROMPT = `Tu es un expert en nutrition. On te fournit la photo du TABLEAU NUTRITIONNEL (et éventuellement de la liste d'ingrédients) d'un produit alimentaire emballé.

Ta mission : TRANSCRIRE les valeurs imprimées. Tu ne dois RIEN estimer ni inventer.

Réponds STRICTEMENT avec un objet JSON valide (aucun texte autour) :
{
  "food_name": "Nom du produit en français, ou description courte si absent",
  "brand": "marque si visible, sinon \\"\\"",
  "per": "100g" | "100ml" | "portion",
  "serving_size_g": 30,
  "calories": 250,
  "macros": { "carbs_g": 30.5, "protein_g": 12.0, "fat_g": 8.5 },
  "micros": { "sugars_g": 12.0, "saturated_fat_g": 3.5, "fiber_g": 2.0, "salt_g": 0.8 },
  "ingredients": "liste d'ingrédients telle qu'imprimée, ou \\"\\"",
  "readable": true,
  "confidence_score": 0.9
}

Règles impératives :
- Recopie les nombres EXACTEMENT tels qu'imprimés. Aucune estimation.
- "per" : indique à quelle base se rapportent les valeurs recopiées. Privilégie la colonne "pour 100 g" ou "pour 100 ml" si elle existe.
- "serving_size_g" : taille d'une portion en grammes si elle est indiquée, sinon 0.
- Si l'énergie n'est donnée qu'en kJ, convertis en kcal (kJ ÷ 4,184) et arrondis.
- Une valeur absente du tableau vaut 0.
- "readable" : false si le tableau est illisible, flou ou absent de l'image.
- Pas d'émojis, pas de markdown.`;

const SYSTEM_PROMPT = `Tu es un expert en nutrition et diététique. On te fournit la photo d'un aliment, d'un plat cuisiné ou d'un produit emballé.
Analyse l'image et estime la portion RÉELLEMENT visible.

Tu réponds STRICTEMENT avec un objet JSON valide respectant EXACTEMENT ce schéma (aucun texte hors du JSON) :
{
  "food_name": "Nom de l'aliment en français",
  "confidence_score": 0.95,
  "estimated_weight_g": 200,
  "calories": 250,
  "macros": { "carbs_g": 30.5, "protein_g": 12.0, "fat_g": 8.5 },
  "is_raw_ingredient": false,
  "alternatives": ["Alternative 1", "Alternative 2"]
}

Règles impératives :
- "food_name" : nom court en français. Si l'image ne contient aucun aliment, mets "" (chaîne vide).
- "confidence_score" : ta confiance dans l'identification, nombre décimal entre 0 et 1.
- "estimated_weight_g" : poids en grammes de la portion visible (entier réaliste).
- "calories" : total de kilocalories pour CETTE portion (estimated_weight_g), pas pour 100 g.
- "macros" : grammes TOTAUX pour cette portion (carbs_g, protein_g, fat_g), décimales autorisées.
- "is_raw_ingredient" : true si c'est un ingrédient brut (ex : pomme, blanc de poulet cru), false si c'est un plat cuisiné/transformé.
- "alternatives" : 2 alternatives plus saines ou proches (noms courts en français). Tableau vide si aucune.
- Cohérence : calories ≈ carbs_g*4 + protein_g*4 + fat_g*9 (±15 %).
- Ne renvoie QUE le JSON, sans balise markdown, sans commentaire.`;

export default async function handler(request) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(allowedOrigin) });
  }
  if (request.method !== "POST") {
    return jsonError("Méthode non autorisée", 405, allowedOrigin);
  }

  // ── Auth (token Supabase) ─────────────────────────────────────────
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

  // ── Corps + validation image ──────────────────────────────────────
  let body;
  try { body = await request.json(); } catch { return jsonError("Corps JSON invalide", 400, allowedOrigin); }

  const { image, mime } = body;
  if (!image || typeof image !== "string" || image.length < 100) {
    return jsonError("Image manquante ou invalide", 400, allowedOrigin);
  }
  if (image.length > MAX_IMAGE_B64) {
    return jsonError("Image trop volumineuse", 413, allowedOrigin);
  }
  const safeMime = (mime === "image/png" || mime === "image/webp") ? mime : "image/jpeg";
  // mode 'label' = transcription du tableau nutritionnel ; sinon identification du plat
  const isLabel = body.mode === "label";

  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return jsonError("Configuration Gemini manquante", 500, allowedOrigin);

  // ── Appel Gemini Vision (JSON natif) ──────────────────────────────
  let apiResp;
  try {
    apiResp = await fetch(GEMINI_URL + "?key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: isLabel ? LABEL_PROMPT : SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: safeMime, data: image } },
              { text: isLabel
                  ? "Transcris le tableau nutritionnel de cette photo et renvoie l'objet JSON demandé."
                  : "Analyse cette image et renvoie l'objet JSON demandé." },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
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
    console.error("[scan-vision] Gemini KO", apiResp.status, String(detail).slice(0, 300));
    return jsonError("Analyse IA indisponible : " + String(detail).slice(0, 120), 502, allowedOrigin);
  }

  const cand = raw.candidates && raw.candidates[0];
  const content =
    (cand && cand.content && Array.isArray(cand.content.parts)
      ? cand.content.parts.map((p) => p.text || "").join("")
      : "") || "";

  const parsed = parseJsonLoose(content);
  if (!parsed) return jsonError("Analyse impossible (format IA inattendu)", 502, allowedOrigin);

  if (isLabel) {
    const lab = normalizeLabel(parsed);
    if (!lab.readable) {
      return jsonError("Tableau nutritionnel illisible sur la photo", 404, allowedOrigin);
    }
    return new Response(JSON.stringify(lab), {
      status: 200,
      headers: { "content-type": "application/json", ...corsHeaders(allowedOrigin) },
    });
  }

  const result = normalize(parsed);
  if (!result.food_name) {
    return jsonError("Aucun aliment reconnu sur l'image", 404, allowedOrigin);
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json", ...corsHeaders(allowedOrigin) },
  });
}

// Parse tolérant : JSON direct, ou JSON noyé dans du texte / balises markdown
function parseJsonLoose(text) {
  if (!text || typeof text !== "string") return null;
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
}

// Normalise la transcription d'étiquette et ramène TOUT à 100 g/ml, base
// unique utilisée par la fiche produit et le journal.
function normalizeLabel(p) {
  const num = (v, min, max, def) => {
    let n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    if (!isFinite(n) || isNaN(n)) n = def;
    return Math.min(max, Math.max(min, n));
  };
  const m = p.macros || {};
  const mi = p.micros || {};
  const serving = Math.round(num(p.serving_size_g, 0, 2000, 0));
  const per = String(p.per || "100g").toLowerCase();
  // Valeurs données par portion : on les rapporte à 100 g (sinon tout est faux)
  const isPortion = per.indexOf("portion") !== -1;
  const factor = isPortion && serving > 0 ? 100 / serving : 1;
  const sc = (v, max) => Math.round(num(v, 0, max, 0) * factor * 10) / 10;

  const cal = Math.round(num(p.calories, 0, 2000, 0) * factor);
  const out = {
    mode: "label",
    readable: p.readable !== false,
    food_name: String(p.food_name || "").trim().slice(0, 80),
    brand: String(p.brand || "").trim().slice(0, 60),
    unit: per.indexOf("ml") !== -1 ? "ml" : "g",
    serving_size_g: serving,
    calories: cal,
    macros: {
      carbs_g: sc(m.carbs_g, 200),
      protein_g: sc(m.protein_g, 200),
      fat_g: sc(m.fat_g, 200),
    },
    micros: {
      sugars_g: sc(mi.sugars_g, 200),
      saturated_fat_g: sc(mi.saturated_fat_g, 200),
      fiber_g: sc(mi.fiber_g, 100),
      salt_g: sc(mi.salt_g, 50),
    },
    ingredients: String(p.ingredients || "").trim().slice(0, 500),
    confidence_score: Math.round(num(p.confidence_score, 0, 1, 0.8) * 100) / 100,
  };
  // Sécurité : des valeurs entièrement nulles = tableau non lu
  if (!out.calories && !out.macros.carbs_g && !out.macros.protein_g && !out.macros.fat_g) {
    out.readable = false;
  }
  if (!out.food_name) out.food_name = "Produit scanné";
  return out;
}

// Normalise / borne les valeurs pour garantir le schéma côté client
function normalize(p) {
  const num = (v, min, max, def) => {
    let n = typeof v === "number" ? v : parseFloat(v);
    if (!isFinite(n) || isNaN(n)) n = def;
    return Math.min(max, Math.max(min, n));
  };
  const m = p.macros || {};
  const carbs = Math.round(num(m.carbs_g, 0, 5000, 0) * 10) / 10;
  const protein = Math.round(num(m.protein_g, 0, 5000, 0) * 10) / 10;
  const fat = Math.round(num(m.fat_g, 0, 5000, 0) * 10) / 10;
  const weight = Math.round(num(p.estimated_weight_g, 1, 5000, 100));
  let calories = Math.round(num(p.calories, 0, 20000, 0));
  // Repli : si l'IA n'a pas donné de calories mais des macros, on les calcule
  if (!calories && (carbs || protein || fat)) {
    calories = Math.round(carbs * 4 + protein * 4 + fat * 9);
  }
  let alts = Array.isArray(p.alternatives) ? p.alternatives : [];
  alts = alts
    .filter((a) => typeof a === "string" && a.trim())
    .map((a) => a.trim().slice(0, 60))
    .slice(0, 3);

  const name = String(p.food_name || "").trim().slice(0, 80);
  const isFood = !!name && (calories > 0 || carbs > 0 || protein > 0 || fat > 0);

  return {
    food_name: name,
    confidence_score: Math.round(num(p.confidence_score, 0, 1, 0.5) * 100) / 100,
    estimated_weight_g: weight,
    calories,
    macros: { carbs_g: carbs, protein_g: protein, fat_g: fat },
    is_raw_ingredient: p.is_raw_ingredient === true,
    alternatives: alts,
    is_food: isFood,
  };
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

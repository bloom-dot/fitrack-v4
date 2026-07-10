# FiTrack V4 — Brief complet pour amélioration avec Fable

> Copie ce fichier en entier dans ta conversation avec Fable.
> FiTrack est une PWA de suivi sportif en français, single-file, déployée sur Vercel + Supabase.

---

## 1. Stack & Architecture

| Composant | Technologie |
|-----------|-------------|
| Frontend | Single-file PWA (`index.html` ~9000 lignes) — HTML + CSS + JS tout inline |
| JS style | **ES5 strict** : `var`, `function`, pas d'arrow functions, pas de classes — compatibilité mobile anciens |
| Backend | Vercel serverless functions (`api/`) en Edge Runtime |
| Base de données | Supabase PostgreSQL avec RLS |
| Auth | Supabase Auth (email/password) |
| IA chat | Mistral AI (`mistral-small-latest`) via `api/chat.js` |
| PWA | `sw.js` (service worker cache shell) + `manifest.json` |
| Déploiement | `vercel --prod --yes` depuis `C:\Users\ferna\Downloads\fitrack` |

**URLs de production :**
- `https://fitrack-swart.vercel.app` (principale)
- `https://fitrack-v4.vercel.app` (alias)

**Supabase projet :** `wszhbpsuujcgjnvvtgfv.supabase.co`

---

## 2. Structure des fichiers

```
fitrack/
├── index.html          ← TOUT est là (HTML, CSS, JS)
├── sw.js               ← Service worker (cache: fitrack-v4-shell-3)
├── manifest.json       ← PWA manifest
├── api/
│   ├── chat.js         ← Proxy Mistral AI (Edge Runtime, quota 30/jour)
│   ├── push-subscribe.js ← Web Push souscription/désouscription
│   ├── send-push.js    ← Envoi notifications push
│   ├── delete-account.js ← Suppression compte RGPD
│   ├── challenges.js   ← Défis hebdomadaires
│   └── cron-weighing.js  ← Rappel pesée (Vercel cron 7h UTC)
├── supabase/
│   ├── schema.sql      ← Schéma complet BDD
│   └── increment-ai-usage.sql ← Fonction atomique quota IA
├── mentions-legales.html
├── confidentialite.html
├── cgu.html
├── cgv.html
└── CLAUDE.md
```

---

## 3. Variables d'environnement Vercel (secrets)

```
MISTRAL_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
VAPID_PRIVATE_KEY
CRON_SECRET
```

**La clé anon Supabase est intentionnellement dans `index.html`** (protégée par RLS — c'est normal, ne pas la déplacer).

---

## 4. Patterns JS fondamentaux

```javascript
// Storage localStorage avec préfixe ft3_
DB.g(key, default)   // get
DB.s(key, val)       // set

// Navigation entre écrans
goTo('screenName')   // toggle .screen divs

// Sécurité XSS
esc(s)              // échappe HTML pour innerHTML
escAttr(s)          // échappe JS+HTML pour onclick="..."

// Exercices
exCat(name)         // lookup catégorie dans EX_DB (insensible à la casse)
muscleToMainCat(muscle) // fallback: 'Poitrine · Triceps' → 'Poitrine'

// Sessions (triées newest-first depuis Supabase)
sessions[]          // array global, sessions[0] = plus récente
prs{}               // personal records
streak              // {count, freezes, freezeMonth}
userProfile         // profil utilisateur
```

---

## 5. Base de données Supabase — Tables clés

| Table | Rôle |
|-------|------|
| `profiles` | Profil utilisateur + préférences + programme |
| `sessions` | Séances (JSON exercises dans colonne `exercises`) |
| `personal_records` | PRs par exercice |
| `weigh_ins` | Pesées |
| `ai_usage` | Quota journalier FitAI (30/jour, atomique via RPC) |
| `push_subscriptions` | Abonnements Web Push |

**Fonction PostgreSQL atomique :** `increment_ai_usage(p_user_id, p_date, p_limit)` — évite race condition check+increment.

---

## 6. Fonctionnalités implémentées

### 🏋️ Entraînement
- Séances en temps réel (timer, séries, poids, reps)
- Programme personnalisé (exercices, fréquence, objectifs)
- Exercices custom (ajout libre)
- EX_DB : ~85 exercices avec catégorie, niveau, équipement, animation GIF, muscles ciblés
- PRs auto-détectés et célébrés

### 📊 Historique & Analytics
- Historique filtrable (semaine/mois/tout)
- Volume chart (barres hebdomadaires)
- Suppression de séance (avec sync Supabase)
- Bilan hebdomadaire automatique le lundi (`#recap-modal`)

### 🤖 FitAI (IA)
- Chat IA Mistral, quota 30 messages/jour
- Contexte utilisateur injecté (profil, séances récentes, PRs)
- Sécurité : auth JWT vérifiée côté serveur, quota atomique, messages sanitisés

### 📸 Coach Mouvement
- Analyse posture via MediaPipe Pose (100% client-side, gratuit)
- Couvre ~35 exercices (`COACH_TYPES`)
- Feedback visuel rouge/vert, bip sonore
- Enregistrement vidéo + suppression

### 🍎 Nutrition
- Journal alimentaire journalier
- Scanner code-barres (Open Food Facts + Open Beauty Facts)
- Estimation calories via IA (description texte)
- Analyse nutriments par rapport à l'objectif

### 🎮 Engagement
- **Mascotte** : 5 mascottes (Kuma, Fenrir, Rex, Ryū, Kitsune), 5 stages visuels **pilotés par le streak** :
  - Stage 1 Rookie : 0–2 jours
  - Stage 2 Motivé : 3–6 jours
  - Stage 3 Déterminé : 7–13 jours
  - Stage 4 Champion : 14–29 jours
  - Stage 5 Légende : 30+ jours
- **Streak freeze** : 1 jeton/mois, consommé auto si 1 seul jour manqué
- **Défi hebdomadaire** : X/N séances avec barre progression
- **Message du jour** : heuristiques locales (muscle négligé, plateau, streak)

### 🔔 Notifications Push
- Rappel pesée quotidien (7h UTC via Vercel cron)
- VAPID + Supabase storage des subscriptions

### 🔐 Sécurité (audit complet effectué)
- XSS : `esc()` et `escAttr()` systématiques
- Quota IA : fonction PostgreSQL atomique (anti race condition)
- Validation UUID dans `send-push.js`
- Validation action dans `push-subscribe.js`
- Messages d'erreur génériques côté API (pas de stack trace)
- `routeAfterAuth()` : timeout 8s + fallback offline (données localStorage)
- Écran de chargement : masqué via `finally` (plus d'écran bloqué)

### 🌐 Offline / PWA
- Service worker cache shell (cache name `fitrack-v4-shell-3`)
- Fallback : si Supabase injoignable → profil localStorage + toast "Mode hors-ligne"
- `init()` try/catch/finally : l'app démarre toujours

---

## 7. Scanner Code-Barres — Architecture actuelle

```javascript
// Chemin 1 : BarcodeDetector natif (Chrome, Android, Edge)
// → getUserMedia direct → caméra s'ouvre immédiatement, pas d'UI lib
// → requestAnimationFrame loop + BarcodeDetector.detect(video)

// Chemin 2 : Html5Qrcode fallback (Safari, Firefox)
// → même résultat mais via la lib html5-qrcode@2.3.8

// Lookup produit :
// 1. Open Food Facts → macros + Nutri-Score + bouton ajout journal
// 2. Si non trouvé → Open Beauty Facts → marque + catégorie
// 3. Si non trouvé → message avec code pour saisie manuelle
```

---

## 8. Conventions CSS

```css
/* Variables CSS root */
--bg, --s1, --s2, --s3    /* backgrounds */
--text, --t2, --t3         /* textes */
--acc                       /* accent = #d4ff00 */
--gold                      /* #ffc340 */
--red, --blue
--border, --border2
--r, --r-sm                /* border-radius */
--nav, --safe              /* hauteurs nav/safe area */
```

**Polices :** `'Barlow Condensed'` (titres, uppercase 700-900) + `'Inter'` (corps)

**iOS compat :** pas d'`inset:0` (utiliser `top:0;right:0;bottom:0;left:0`), pas de `screen.orientation.lock()`.

---

## 9. Écrans (navigation `goTo()`)

| ID écran | Rôle |
|----------|------|
| `landing-screen` | Page d'accueil marketing (1ère visite) |
| `auth-screen` | Login/Register |
| `onboarding-screen` | Onboarding nouvel utilisateur |
| `home` | Accueil (mascotte, message du jour, défi, reco) |
| `screen-session` | Séance en cours |
| `screen-history` | Historique séances |
| `screen-social` | Volet social + ajout séance manuelle |
| `screen-nutrition` | Journal nutrition |
| `screen-library` | Bibliothèque exercices |
| `screen-records` | Records personnels |
| `screen-coach` | Coach Mouvement (caméra) |
| `screen-ai` | FitAI chat |
| `profile` | Profil + paramètres |

---

## 10. Bugs corrigés récemment (cette semaine)

| Bug | Cause | Fix |
|-----|-------|-----|
| Écran chargement bloqué (mobile + PC) | SRI hash cassé sur `@supabase/supabase-js@2` (CDN floating) | Pinné `@2.49.4`, SRI retiré |
| `stopBarcodeCamera()` crash | Fonction appelée mais non définie | Définie |
| Message "11j sans Poitrine" faux positif | `exCat()` sensible à la casse + `cat:'Musculation'` ignoré | `exCat()` case-insensitive + fallback `muscleToMainCat()` |
| Liste exercices sociale incomplète | EX_DB limité à 40 exercices + `slice(0,30)` | EX_DB étendu à ~85 + suppression slice |
| Race condition quota IA | Check+increment non atomique | Fonction PostgreSQL `increment_ai_usage` atomique |
| Scanner caméra ne s'ouvrait pas directement | `Html5QrcodeScanner` génère UI propre non contrôlable | Réécriture avec `getUserMedia` + `BarcodeDetector` natif |

---

## 11. Ce qui reste à améliorer (axes pour Fable)

### 🚀 Performance
- [ ] `index.html` ~9000 lignes → explorer code splitting (lazy load écrans)
- [ ] EX_DB en JSON externe chargé à la demande
- [ ] Images/GIFs Coach : lazy loading
- [ ] Optimiser `syncSessionsPRsStreak()` (trop d'appels Supabase séquentiels)

### 🎨 UI/UX
- [ ] Onboarding redesign (trop long, taux abandon probable)
- [ ] Écran home : réorganiser les cartes (mascotte, message du jour, défi)
- [ ] Mode paysage (actuellement bloqué portrait via overlay)
- [ ] Animations transitions entre écrans (actuellement switch brutal)
- [ ] Dark mode toggle (actuellement forcé dark)
- [ ] Graphiques nutrition plus riches (macros pie chart, évolution sur 7j)
- [ ] Historique : filtres par groupe musculaire

### 📱 Mobile
- [ ] Haptic feedback (Vibration API) sur plus d'interactions
- [ ] Partage séance (Web Share API)
- [ ] Raccourci "Reprendre dernière séance"

### 🧠 IA / Data
- [ ] Groq vision comme fallback scanner (identifier produit sans code-barres)
- [ ] Recommendations exercices basées sur historique (ML côté client)
- [ ] FitAI : mémoire longue (résumé historique injecté en contexte)
- [ ] Analyse plateau automatique (déjà partiellement fait dans `detectPlateau()`)

### 🔐 Sécurité restante
- [ ] CSP (Content Security Policy) headers dans `vercel.json`
- [ ] Rate limiting API `api/chat.js` par IP (en plus du quota utilisateur)
- [ ] Rotation VAPID keys

### 💰 Monétisation (prévu 2,99€/mois ou 19,99€/an)
- [ ] Intégration Stripe Checkout
- [ ] Webhook Stripe → Supabase (colonne `subscribed` dans `profiles`)
- [ ] Blocage features premium si non abonné
- [ ] Portail client (annulation, factures)
- [ ] Remplir placeholders mentions légales (SIRET, adresse)

### 🌍 Distribution
- [ ] SEO : meta tags dynamiques, sitemap, robots.txt
- [ ] PWA installable : améliorer le prompt d'installation
- [ ] Internationalisation (l'app est 100% FR, prête pour i18n)

---

## 12. Modèle commercial

- **Prix :** 2,99 €/mois ou 19,99 €/an
- **Plan unique :** tout inclus (programme, séances, records, Coach Mouvement, FitAI)
- **Pas de version gratuite** (décision ferme de l'utilisateur)
- **Légal :** CGU, CGV, Mentions légales, Politique confidentialité créées (standalone HTML, thème dark)
- **RGPD :** consentement données de santé au register, suppression compte via `api/delete-account.js`

---

## 13. Prompts utiles pour Fable

### Pour améliorer le code :
> "Voici FiTrack, une PWA de suivi sportif single-file (`index.html` ~9000 lignes, ES5 strict, `var` only, no arrow functions). [coller ce brief]. Améliore [X feature] en respectant les conventions ES5 et sans introduire de dépendances nouvelles."

### Pour un audit :
> "Fais un audit complet de [performance / sécurité / UX / accessibilité] de cette PWA et propose des corrections priorisées par impact."

### Pour une nouvelle feature :
> "Implémente [feature] dans FiTrack. L'app est single-file (`index.html`), toutes les fonctions sont globales, navigation via `goTo('screen')`, storage via `DB.g()/DB.s()`, Supabase pour la persistance cloud."

---

## 14. Commandes utiles

```bash
# Déploiement production
cd C:\Users\ferna\Downloads\fitrack
vercel --prod --yes

# Validation syntaxe JS avant déploiement
node -e "var fs=require('fs');var src=fs.readFileSync('index.html','utf8');var m=src.match(/<script>([\s\S]*?)<\/script>/g);var js=m?m.map(function(s){return s.replace(/<\/?script>/g,'');}).join('\n'):'';new Function(js);console.log('OK');"
```

---

*Brief généré le 2 juillet 2026 — session Claude Sonnet 4.6*

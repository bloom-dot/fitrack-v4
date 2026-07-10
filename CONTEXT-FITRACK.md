# Contexte FiTrack — Handoff pour nouvelle conversation

## Projet

FiTrack est une PWA de suivi sportif en français. Tout le code front est dans un **seul fichier `index.html`** (~5000 lignes) : HTML + CSS inline (`<style>`) + JS inline (`<script>`). Aucun framework, aucun bundler.

## Stack technique

- **Frontend :** Vanilla JS (ES5 — `var`, pas de `let`/`const`/arrow functions), CSS variables, PWA (manifest.json + sw.js)
- **Backend :** Vercel serverless functions dans `api/` (Node.js)
- **BDD :** Supabase PostgreSQL + Auth + RLS. Schéma dans `supabase/schema.sql`
- **IA :** Mistral API via proxy `api/chat.js` (quota journalier via table `ai_usage`)
- **Notifications :** Web Push (VAPID) via `api/push-subscribe.js` et `api/send-push.js`
- **Cron :** `api/cron-weighing.js` rappel pesée quotidien 7h UTC (config dans `vercel.json`)

## Déploiement

```bash
cd C:\Users\ferna\Downloads\fitrack
vercel --prod --yes
```

- **Projet Vercel :** `myfitrack/fitrack`
- **URL prod :** `https://fitrack-swart.vercel.app`
- **Variables env Vercel :** `MISTRAL_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`
- Les clés Supabase anon + VAPID publique sont dans `index.html` (normal : RLS protège les données, VAPID public est public par design)

## Validation JS après chaque modification

```bash
node -e "var fs=require('fs');var src=fs.readFileSync('index.html','utf8');var m=src.match(/<script>([\s\S]*?)<\/script>/g);var js=m?m.map(function(s){return s.replace(/<\/?script>/g,'');}).join('\n'):'';new Function(js);console.log('OK');"
```

Pas de tests, pas de linter. Ce one-liner est la seule validation.

## Architecture de index.html

### CSS (lignes ~1-600)
- Variables `:root` : `--bg`, `--acc`, `--s1`, `--s2`, `--border`, `--text`, `--t2`, `--r`, `--r-sm`, `--nav`, `--safe`
- `.screen` = pages de l'app (display:none/flex), `.scroll` = zone scrollable, `.card` = carte standard
- `.btn-primary` et `.btn-outline` ont `width:100%` par défaut — attention en contexte flex sur mobile

### HTML (lignes ~600-1600)
- Écrans : `screen-home`, `screen-log` (séance), `screen-records`, `screen-history`, `screen-coach`, `screen-profile`, `screen-measurements`, `screen-nutrition`, `screen-badges`, `screen-cardio`
- Navigation par `goTo('screenId')`
- Modals : `ex-modal` (choix exercice), `rm-modal` (1RM), `prev-modal` (détail exercice), `pwa-modal`, `progression-modal`

### JS (lignes ~1600-5000)
- **LocalStorage :** `DB.g(key, default)` / `DB.s(key, val)` — préfixe `ft3_`
- **Données clés :** `sessions=DB.g('sessions',[])`, `prs=DB.g('prs',{})`, `measurements=DB.g('measurements',[])`
- **Bibliothèque exercices :** `EX_DB[]` — chaque entrée a `{name, muscle, cat, level, equip, injury, anim, desc, steps}`
  - `cat:'Cardio'` = exercice cardio → inputs min/km au lieu de kg/reps dans la séance
- **Blocs exercice :** `addExBlock(name, muscle, sugWeight, sugReps, nbSets, cat)` → crée un bloc dans la séance avec séries
- **Sets :** `addSetRow(bid, sug, r, isCardio)` — si cardio : inputs min/km, sinon : kg/reps
- **Fin de séance :** `finishSession()` — sauvegarde, calcul PR, sync Supabase
- **Programme :** `program=DB.g('program',null)` — jours de la semaine avec exercices prédéfinis
- **Coach Mouvement :** utilise MediaPipe Pose (gratuit) pour analyse de mouvement via caméra
- **TTS :** `coachTTSEnabled=DB.g('coachTTS',true)` — feedback coach lu à voix haute (Web Speech API)
- **Orientation :** overlay `#orientation-guard` + `matchMedia('(orientation:landscape)')` pour bloquer le paysage (iOS compatible)
- **Streaks :** compteur de jours consécutifs avec freeze mensuel
- **Badges :** système de gamification par objectifs
- **Récap hebdomadaire :** bilan auto chaque lundi

## Tables Supabase principales

| Table | Rôle |
|---|---|
| `profiles` | Onboarding (âge, objectifs, équipement, blessures, programme) |
| `sessions` | Séances (exercises JSONB, durée, volume) |
| `personal_records` | PR par exercice (poids, reps, 1RM estimé) |
| `weigh_ins` | Pesées corporelles |
| `ai_usage` | Quota messages IA par jour |
| `push_subscriptions` | Endpoints push notification |

Toutes les tables ont RLS sur `auth.uid()`.

## API Vercel (`api/`)

| Fichier | Méthode | Rôle |
|---|---|---|
| `chat.js` | POST | Proxy Mistral AI, auth Bearer, limite quotidienne |
| `cron-weighing.js` | GET | Cron Vercel 7h UTC, envoie push rappel pesée |
| `push-subscribe.js` | POST | Enregistre endpoint push |
| `send-push.js` | POST | Envoie une notification push |
| `challenges.js` | POST | Gestion défis hebdomadaires |
| `delete-account.js` | DELETE | Suppression compte RGPD |

## Conventions de code

- **Langue :** tout en français (UI, commentaires)
- **JS :** ES5 strict — `var`, `function`, pas de `let`/`const`/`=>`
- **iOS :** pas de `inset:0` (utiliser `top:0;right:0;bottom:0;left:0`), pas de `screen.orientation.lock()`, speechSynthesis nécessite un geste utilisateur
- **Commentaires :** aucun sauf si le "pourquoi" est non évident
- **Pas de fichiers séparés :** tout le CSS et JS restent dans index.html

## État actuel / Points en suspens

- **Renommage app :** l'utilisateur cherche un nom avec "fit" (FiTrack/FitAI/Coach Mouvement à renommer)
- **Google OAuth :** nécessite configuration Google Cloud Console
- **Stripe :** intégration paiement pas encore faite
- **`USER_PLAN`** : hardcodé `'free'` côté client — à sécuriser côté serveur
- **Sync Supabase :** historique cardio et coach encore en localStorage uniquement

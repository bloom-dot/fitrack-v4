# FiTrack — Fichier de reprise de projet

> À donner à Claude au début d'une nouvelle discussion pour reprendre le travail exactement où il s'est arrêté.
> Dernière mise à jour : 2026-07-10 (fin de session, tout est déployé en prod).

## L'essentiel en 30 secondes

- **Quoi** : FiTrack, PWA française de suivi sportif + nutrition + coach IA. Single-file : tout (HTML/CSS/JS) est dans `index.html` (~8000 lignes), pas de framework, pas de bundler. JS style ES5 (`var`, pas d'arrow functions).
- **Où** : `C:\Users\ferna\Downloads\fitrack` · Prod : **https://fitrack-v4.vercel.app** (projet Vercel `myfitrack/fitrack`) · Backend : Supabase `wszhbpsuujcgjnvvtgfv.supabase.co` (RLS) + fonctions serverless dans `api/`.
- **État** : **bêta ouverte** — `BETA_MODE=true` dans index.html force le plan Elite pour tous (aucun paywall actif). À passer à `false` + brancher Stripe au lancement commercial.
- **Utilisateur** : débutant en code → expliquer en français simple, donner les commandes exactes, déployer soi-même après chaque changement.

## Commandes vitales

```bash
# Déploiement production (TOUJOURS depuis le dossier fitrack)
cd C:\Users\ferna\Downloads\fitrack
vercel --prod --yes

# Validation syntaxe JS AVANT tout déploiement (obligatoire)
node -e "var fs=require('fs');var src=fs.readFileSync('index.html','utf8');var m=src.match(/<script>([\s\S]*?)<\/script>/g);var js=m?m.map(function(s){return s.replace(/<\/?script>/g,'');}).join('\n'):'';new Function(js);console.log('OK');"
```

**Après chaque déploiement qui touche index.html : incrémenter `CACHE_NAME` dans `sw.js`** (actuellement `fitrack-v4-shell-27`) sinon les PWA installées servent l'ancienne version. L'utilisateur doit ensuite fermer/rouvrir l'app 2× sur téléphone.

## ⚠️ Pièges connus (durement appris — NE PAS re-casser)

1. **CSP et WASM** : la Content-Security-Policy dans `vercel.json` DOIT contenir `'unsafe-eval' 'wasm-unsafe-eval'` dans `script-src`, sinon MediaPipe (WASM) meurt en prod avec `CompileError`. **La preview locale n'applique PAS ces headers** → toute feature WASM/CSP se teste sur l'URL de PROD. Après un changement de header seul, modifier aussi un octet d'index.html (sinon 304 → les navigateurs gardent les anciens headers).
2. **MediaPipe Pose** : toujours `await coachPose.initialize()` avant le premier `send()` (sinon RuntimeError + modèle mort) ; jamais deux `send()` en parallèle (flag `_coachSending`) ; version CDN épinglée `@mediapipe/pose@0.5.1675469404` partout ; **ne jamais toucher à `enableSegmentation` via `setOptions` en cours de flux** (casse le graphe mobile — l'aura DBZ a été retirée pour ça, à la demande de l'utilisateur : ne pas la réintroduire).
3. **iOS** : `speechSynthesis` exige une utterance muette lancée en synchrone dans le premier geste utilisateur (fait dans `toggleCoachCamera`) ; `navigator.vibrate` n'existe pas sur iOS (pas un bug) ; pas de `inset:0` en CSS.
4. **Client Supabase = `sb`**, pas `supabase` (ce nom est le namespace de la librairie — un bug historique du scanner venait de là).
5. Hook PostToolUse : un déploiement auto async part à chaque Edit/Write sur fitrack — le `vercel --prod --yes` manuel final reste la référence.

## Architecture rapide

- `index.html` — tout le front. Repères : `DB.g/DB.s` (localStorage préfixe `ft3_`), `EX_DB[]` (exercices), `sessions[]`/`prs{}`, navigation `goTo('screenId')`, plan/paywall section `═══ PLAN / PAYWALL ═══`.
- `api/` : `chat.js` (Mistral, quota 30 msgs/j/user), `scan-vision.js` (Groq llama-4-scout : produit depuis photo, renvoie macros), `coach-vision.js` (conseil technique depuis image de la pire rep — **endpoint prêt mais plus appelé côté client** depuis le retour arrière du coach), `challenges.js`, push, delete-account, cron.
- Env Vercel : `MISTRAL_API_KEY`, `GROQ_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`.
- `diag.html` — page de diagnostic MediaPipe/CSP/caméra (à faire ouvrir sur le téléphone en cas de problème caméra).
- Git : remote `github.com/bloom-dot/fitrack-v4` (branche `main`, à jour). Dernier checkpoint poussé le 2026-07-10 (`28df8d3` : Coach Mouvement + scanner Yuka + nutrition Yazio + refonte UX). `__pycache__`/`*.pyc` ignorés.

## Ce qui a été fait récemment (juillet 2026)

### Coach Mouvement
- Squelette rouge→vert temps réel (MediaPipe), bip position, compteur de reps fiabilisé (anti-scintillement 3 frames, min 4 frames tenues, 1,2 s entre reps), score /100 (angle secondaire pondéré 30 %), barre fatigue, replay vidéo + partage.
- **Voix par mascotte** (`MASCOT_VOICE`) : pitch/débit/phrases signature par personnage (Kuma grave-lent → Chimp aigu-rapide), salutation au lancement, file d'attente vocale (plus de phrases coupées), résumé vocal de fin de séance.
- **Analyse différée** (carte 🎬) : filme ta série → vidéo annotée squelette + courbe d'angles Chart.js + reps/scores + conseil VLM (pipeline « RF-DETR+Python » reproduit 100 % client-side).
- Retiré à la demande explicite de l'utilisateur (ne pas réintroduire sans demande) : aura Super Saïyan, score live, cadre coloré, flash de rep géant, bilan visuel de série, analyse IA auto de fin de série.

### Nutrition / Scanner (niveau Yazio)
- **Scanner plein écran façon Yuka** : caméra immersive sans masque, viseur à coins lumineux qui respire, topbar flottante (✕/torche 🔦), fiche produit en tiroir bas par-dessus la caméra, multi-scan enchaîné.
- Vitesse : formats limités à EAN13/EAN8/UPC-A/UPC-E des deux chemins, iOS (Html5Qrcode) : fps 30, qrbox 85 %×40 %, `disableFlip`, 1080p. **⚠️ À faire vérifier par l'utilisateur sur iPhone — dernière optimisation pas encore testée en réel.**
- Quantités intelligentes : contenance/portion détectées (canette 330 ml par défaut), unité ml pour boissons, boutons portions (100/portion/bouteille/verre/càs), macros décimales, repli valeurs-par-portion.
- Écran nutrition : anneaux kcal restantes + P/G/L, récents & favoris (re-log 1 tap), recherche par nom (OFF + aliments perso), journal groupé par repas (auto selon l'heure) avec édition/duplication/étoile, hydratation (verres 250 ml), copier la journée d'hier, création d'aliment/recette (somme d'ingrédients), cache hors ligne 100 produits, micros repliables (sucres/sel/saturés/fibres, code couleur), alternative Nutri-Score A si produit D/E.

### UX globale (audit multi-profils appliqué)
- Onboarding express (« Laisse FiTrack choisir pour moi »), recap hebdo jamais à la 1re visite, séance pré-remplie depuis le programme du jour, checklist « Bien démarrer » 3 étapes, tour guidé 5 slides (1re connexion), jargon francisé (Pousser/Tirer, Jours d'affilée), Social→Communauté, bannière « complète ton profil » sur nutrition, landing 1 CTA + bandeau bêta gratuite, affichage simplifié (réglage profil), mascotte accueillante pour nouveau compte.
- **FAB (bouton jaune)** : appui long ~450 ms → menu 5 actions (séance libre/coach/scanner/cardio/séance passée), apparence contextuelle (+ / minutes de séance / ✓), anneau de progression des séries.

## Chantiers ouverts / prochaines étapes probables

1. **Vitesse scanner iPhone** : optimisation déployée (shell-27) mais retour utilisateur attendu. Si encore lent : envisager `zxing-wasm` moderne ou détecter iOS 17+ BarcodeDetector.
2. **Voix mascottes option 2** : vraies voix distinctes pré-générées en MP3 (ElevenLabs/OpenAI TTS, phrases fixes → assets locaux, zéro coût runtime). Utilisateur intéressé.
3. **Lancement commercial** : `BETA_MODE=false`, brancher Stripe (rien n'existe), plans Gratuit/Pro 4,99 €/Elite 9,99 € déjà dans le code et la landing. Placeholders légaux à remplir (SIRET, adresse) dans mentions-legales.html et cgv.html.
4. **Réactiver le conseil IA coach** (endpoint `coach-vision.js` prêt) si l'utilisateur redemande du feedback VLM.
5. ~~Committer + pousser le travail récent sur git.~~ ✅ Fait (checkpoint `28df8d3`, 2026-07-10).

## Mémoire persistante

Les leçons techniques et l'état projet sont aussi dans la mémoire de Claude (`projet-fitrack-v4.md`, `web-dev-patterns-reutilisables.md`) — elles se chargent automatiquement dans les nouvelles sessions du même dossier de travail (`C:\Users\ferna\Downloads`).

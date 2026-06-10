# FiTrack V4 — Architecture du projet

PWA de suivi sportif en français. Reconstruction V4 avec backend léger
(fonction serverless Vercel) et base de données (Supabase), tout en
restant 100% gratuit, déployée via GitHub + Vercel.

## Structure du dossier

```
fitrack/
├── index.html        -> La PWA (page principale)
├── manifest.json
├── sw.js              (service worker, hors-ligne)
├── css/
├── js/
├── assets/icons/
├── api/
│   └── chat.js        -> Fonction serverless Vercel : proxy Anthropic
├── supabase/
│   └── schema.sql      -> Tables + Row Level Security
└── docs/               -> Guides étape par étape
```

## Pourquoi cette architecture ?

- **Tout le projet vit dans UN SEUL repo GitHub.** Vercel est connecté à
  ce repo : à chaque `git push`, le site ET la fonction `api/chat.js`
  sont redéployés automatiquement. Gratuit (plan Hobby de Vercel).
- **`api/chat.js`** : reçoit les messages du chat FitAI, ajoute la clé
  API Anthropic (stockée comme variable d'environnement secrète dans
  Vercel, jamais visible dans le code ni le navigateur) et relaie la
  requête à Anthropic.
- **`supabase/`** : Supabase fournit gratuitement l'authentification
  (email/mot de passe, Google) ET une base de données PostgreSQL où
  chaque utilisateur ne voit que ses propres données (Row Level
  Security).

## Feuille de route (par étapes)

- [x] **Étape 0** — Structure du projet
- [ ] **Étape 1** — Déployer sur Vercel via GitHub (site + proxy IA)
- [ ] **Étape 2** — Création du projet Supabase + schéma de base de données
- [ ] **Étape 3** — Authentification Supabase (remplace le login simulé)
- [ ] **Étape 4** — Migration des données (profil, séances, PR, nutrition)
      du `localStorage` vers Supabase
- [ ] **Étape 5** — Suivi poids & mensurations + graphique d'évolution
- [ ] **Étape 6** — Gamification : streaks + badges
- [ ] **Étape 7** — Finalisation PWA (manifest, service worker, icônes)

Chaque étape a son propre guide dans `docs/`, écrit pour un débutant :
quoi faire, où cliquer, et pourquoi.

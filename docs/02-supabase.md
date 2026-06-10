# Étape 2 — Base de données Supabase

Objectif : créer les tables qui stockeront les données de chaque
utilisateur (profil, séances, PR, mensurations, streak, badges), avec
isolation automatique des données par utilisateur (Row Level Security).

## 1. Exécuter le script SQL

1. Dans le tableau de bord Supabase de ton projet, clique sur l'icône
   **SQL Editor** dans le menu de gauche (icône `</>`)
2. Clique **"New query"**
3. Ouvre le fichier [`supabase/schema.sql`](../supabase/schema.sql) de ce
   projet, copie tout son contenu
4. Colle-le dans l'éditeur SQL de Supabase
5. Clique **"Run"** (ou `Ctrl+Entrée`)

Tu devrais voir "Success. No rows returned". 6 tables sont créées :
`profiles`, `sessions`, `personal_records`, `body_measurements`,
`streaks`, `badges`.

## 2. Vérifier les tables

Dans le menu de gauche, clique **"Table Editor"** — tu dois voir les 6
tables listées.

## 3. Récupérer les clés API

1. Clique sur l'icône **engrenage (Project Settings)** en bas à gauche
2. Va dans **"API"** (ou "Data API")
3. Note ces deux valeurs (on en aura besoin à l'étape suivante) :
   - **Project URL** (ex: `https://wszhbpsuujcgjnvvtgfv.supabase.co`)
   - **anon public** key (une longue chaîne commençant par `eyJ...`)

⚠️ La clé `anon public` est faite pour être visible côté client (dans le
code de l'app) — ce n'est pas un secret. C'est la combinaison
RLS + authentification qui protège les données.

## Prochaine étape

➡️ Étape 3 : intégrer Supabase Auth dans l'app (remplacer le login
simulé) et connecter le profil/les données à ces tables.

Envoie-moi le **Project URL** et la clé **anon public** une fois
récupérés.

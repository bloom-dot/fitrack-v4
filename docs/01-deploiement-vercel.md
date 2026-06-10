# Étape 1 — Déployer sur Vercel via GitHub

Objectif : avoir le site FiTrack en ligne sur une URL `*.vercel.app`,
avec FitAI fonctionnel sans clé API exposée. À chaque `git push`, le
site se met à jour tout seul.

## 1. Créer un dépôt GitHub pour ce projet

Si tu veux repartir propre (recommandé pour la V4), crée un nouveau
dépôt vide sur https://github.com/new (par exemple `fitrack-v4`).

Tu peux aussi réutiliser le dépôt existant `MyFitrack/fitrack`, mais
attention : il contient l'ancienne version (GitHub Pages). Un nouveau
dépôt évite les conflits.

## 2. Envoyer le projet sur GitHub

Dans PowerShell, place-toi dans le dossier du projet :

```powershell
cd C:\Users\ferna\Downloads\fitrack
git init
git add .
git commit -m "FiTrack V4 - structure initiale"
git branch -M main
git remote add origin https://github.com/<TON-PSEUDO>/fitrack-v4.git
git push -u origin main
```

(Remplace `<TON-PSEUDO>` et le nom du dépôt par les tiens.)

## 3. Créer un compte Vercel (gratuit)

1. Va sur https://vercel.com/signup
2. Choisis **"Continue with GitHub"** — ça lie directement ton compte
   GitHub, pas besoin de carte bancaire.

## 4. Importer le projet

1. Sur le tableau de bord Vercel, clique **"Add New..." → "Project"**.
2. Trouve ton dépôt `fitrack-v4` dans la liste et clique **"Import"**.
3. Vercel détecte automatiquement qu'il n'y a pas de framework
   ("Other") — laisse les réglages par défaut.
4. **Avant de cliquer sur Deploy**, déplie **"Environment Variables"**
   et ajoute :
   - **Name** : `ANTHROPIC_API_KEY`
   - **Value** : ta clé API (commence par `sk-ant-...`, récupérable sur
     https://console.anthropic.com/settings/keys)
5. Clique **"Deploy"**.

## 5. Récupérer l'URL

Au bout d'1-2 minutes, Vercel affiche ton site en ligne, à une adresse
du type :

```
https://fitrack-v4-<ton-pseudo>.vercel.app
```

**Ouvre cette URL**, va dans l'onglet FitAI et envoie un message pour
vérifier que la réponse de Claude arrive bien.

## 6. Mises à jour automatiques

À partir de maintenant, à chaque fois qu'on modifiera le code, il
suffira de faire :

```powershell
git add .
git commit -m "description du changement"
git push
```

Vercel redéploie automatiquement en 1-2 minutes.

## Sécurité

- La clé API Anthropic est stockée uniquement dans **Vercel → Project
  Settings → Environment Variables**, jamais dans le code du dépôt.
- `api/chat.js` valide le format des messages avant de les transmettre
  à Anthropic et plafonne `max_tokens`.

## Prochaine étape

➡️ Étape 2 : créer le projet Supabase (authentification + base de
données). Dis-moi quand ton site est en ligne et que FitAI répond.

# Étape 3 — Authentification Supabase

L'app utilise maintenant Supabase pour l'inscription, la connexion, la
déconnexion et "mot de passe oublié". Il reste 2 réglages à faire dans
le tableau de bord Supabase pour que tout fonctionne correctement une
fois le site en ligne.

## 1. Configurer l'URL du site

Par défaut, Supabase renvoie les liens de confirmation d'e-mail vers
`localhost`. Il faut lui dire où se trouve ton vrai site :

1. Dans Supabase, va dans **Authentication** (icône cadenas dans le
   menu de gauche) → **URL Configuration**
2. **Site URL** : mets l'URL de ton site Vercel, par exemple
   `https://fitrack-v4.vercel.app`
3. Dans **Redirect URLs**, ajoute aussi cette même URL
4. Clique **Save**

## 2. Confirmation d'e-mail (optionnel pour les tests)

Par défaut, après "Créer mon compte", Supabase envoie un e-mail de
confirmation et l'utilisateur doit cliquer dessus avant de pouvoir se
connecter.

Pour **tester rapidement sans gérer les e-mails** (à réactiver avant un
vrai lancement) :

1. **Authentication** → **Providers** → **Email**
2. Désactive **"Confirm email"**
3. **Save**

⚠️ Remets cette option active si tu ouvres l'app à de vrais
utilisateurs, pour éviter les faux comptes.

## 3. Connexion Google (optionnel)

Le bouton "Google" est câblé mais nécessite une configuration
supplémentaire (création d'identifiants OAuth sur Google Cloud
Console, gratuit). On pourra le faire dans une étape dédiée si tu
veux activer ce bouton — pour l'instant, l'inscription par e-mail/mot
de passe suffit pour avancer.

Le bouton "Apple" affiche un message "bientôt disponible" : Apple Sign
In nécessite un compte développeur Apple payant (99$/an), donc on ne
l'active pas pour rester gratuit.

## 4. Mettre en ligne les changements

Dans PowerShell :

```powershell
cd C:\Users\ferna\Downloads\fitrack
git add .
git commit -m "Ajout authentification Supabase"
git push
```

Vercel redéploie automatiquement (1-2 minutes).

## 5. Tester

1. Ouvre ton site (`https://fitrack-v4.vercel.app`)
2. Crée un compte avec un e-mail et un mot de passe (8+ caractères)
3. Tu devrais arriver sur l'onboarding (5 étapes)
4. Termine l'onboarding → tu arrives sur l'app
5. Va dans **Profil → Se déconnecter**, puis reconnecte-toi avec le
   même e-mail/mot de passe → tu dois retomber directement dans l'app
   (pas dans l'onboarding), preuve que ton profil a bien été
   sauvegardé dans Supabase

## Vérifier dans Supabase

Dans **Table Editor → profiles**, tu devrais voir une ligne
correspondant à ton compte, avec `onboarding_done = true`.

## Prochaine étape

➡️ Étape 4 : migrer les séances, records (PR), nutrition vers
Supabase (actuellement encore dans `localStorage`).

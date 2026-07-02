# Culturafición · Frise de la saison

Planning collaboratif des événements de l'association (soirées, conférences,
tentaderos prácticos, retransmissions, assemblée générale…), sous forme de
frise sur 12 mois. Interface « cartel taurin » (rouge, sable, or, encre),
partagée entre les membres du bureau via un code d'accès unique.

- **Frontend** : React + Vite, hébergé sur **Cloudflare Pages**.
- **Backend** : **Cloudflare Pages Functions** (dossier `functions/`).
- **Base de données** : **Cloudflare D1** (`culturaficion_planning`, juridiction UE).

Tout tient dans les offres gratuites de Cloudflare.

---

## 1. Ce que contient ce dépôt

```
src/            Interface (React) — le design d'origine, à l'identique
functions/api/  Endpoints serveur (Pages Functions)
migrations/     Schéma SQL de la base D1 + catégories par défaut
wrangler.toml   Configuration de développement local (facultatif)
```

Aucun code d'accès n'est écrit dans le code : il est vérifié côté serveur
contre la variable d'environnement `ACCESS_CODE`, définie plus loin dans le
tableau de bord Cloudflare.

---

## 2. Déploiement pas à pas (tableau de bord Cloudflare)

Cette section suppose que vous n'avez jamais utilisé Cloudflare Pages. Suivez
les étapes dans l'ordre ; chacune correspond à un ou deux clics dans le
tableau de bord.

### Étape 1 — Pousser le code sur GitHub

Le code doit être sur la branche par défaut du dépôt GitHub connecté à votre
compte Cloudflare (généralement `main`). Si ce n'est pas déjà fait, demandez
à la personne qui gère le dépôt de fusionner cette branche, ou faites-le
vous-même depuis l'interface GitHub (bouton **Merge pull request**).

### Étape 2 — Créer la base de données D1 (si pas déjà fait)

> Si la base `culturaficion_planning` existe déjà (c'est indiqué dans la
> consigne du projet), passez directement à l'étape 3.

1. Dans le tableau de bord Cloudflare, ouvrez le menu **Stockage et bases de
   données** (Storage & Databases) puis **D1 SQL Database**.
2. Cliquez sur **Créer une base de données**.
3. Nommez-la `culturaficion_planning`, choisissez la région **Union
   européenne (UE)**, puis validez.

### Étape 3 — Créer le projet Cloudflare Pages relié au dépôt

1. Dans le tableau de bord Cloudflare, ouvrez **Workers & Pages**.
2. Cliquez sur **Créer une application** (Create application) puis sur
   l'onglet **Pages**.
3. Choisissez **Connecter à Git** (Connect to Git) et sélectionnez le dépôt
   GitHub `culturaficion-planning`. Autorisez l'accès si demandé.
4. Dans les réglages de build, renseignez :
   - **Commande de build (Build command)** : `npm run build`
   - **Répertoire de sortie (Build output directory)** : `dist`
5. Cliquez sur **Enregistrer et déployer** (Save and Deploy).

Un premier déploiement démarre automatiquement. Il échouera probablement à
ce stade lors de l'utilisation de l'app (erreur 401/500 sur les données) car
il manque encore la base D1 et le code d'accès — c'est normal, on les ajoute
juste après.

À partir de maintenant, **chaque `git push` sur la branche par défaut
redéploiera automatiquement** le site.

### Étape 4 — Lier la base D1 au projet Pages

1. Ouvrez votre projet Pages fraîchement créé (**Workers & Pages** → nom du
   projet).
2. Allez dans l'onglet **Settings** (Réglages) → **Functions** (Fonctions).
3. Descendez jusqu'à **D1 database bindings** (Liaisons de base de données
   D1) et cliquez sur **Add binding** (Ajouter une liaison).
4. Renseignez :
   - **Variable name** (nom de la variable) : `DB` — important, le code du
     projet attend exactement ce nom.
   - **D1 database** : sélectionnez `culturaficion_planning`.
5. Cliquez sur **Save** (Enregistrer).
6. Faites-le pour les deux environnements proposés s'ils apparaissent
   séparément (**Production** et **Preview**).

### Étape 5 — Définir le code d'accès (`ACCESS_CODE`)

1. Toujours dans **Settings** → cette fois la section **Environment
   variables** (Variables d'environnement).
2. Cliquez sur **Add variable** (Ajouter une variable).
3. Renseignez :
   - **Variable name** : `ACCESS_CODE`
   - **Value** : le code que le bureau utilisera pour accéder à la frise
     (ex. un mot de passe court, facile à partager par SMS/WhatsApp).
4. Cliquez sur **Encrypt** (Chiffrer) si l'option est proposée, pour que le
   code n'apparaisse plus en clair dans le tableau de bord ensuite.
5. Enregistrez, puis faites de même pour l'environnement **Preview** si
   demandé (vous pouvez y mettre le même code ou un code différent).

### Étape 6 — Appliquer le schéma SQL sur la base D1

Cette étape nécessite d'exécuter une commande une seule fois, depuis un
ordinateur avec Node.js installé (elle ne se fait pas depuis le tableau de
bord).

1. Récupérez le code du dépôt sur votre ordinateur (`git clone …`) puis, dans
   le dossier du projet, installez les dépendances :
   ```
   npm install
   ```
2. Connectez l'outil en ligne de commande à votre compte Cloudflare (une
   fenêtre de navigateur s'ouvre pour vous authentifier) :
   ```
   npx wrangler login
   ```
3. Appliquez le schéma et les données par défaut sur la vraie base D1
   (notez le `--remote`, qui vise la base en ligne et non une base locale) :
   ```
   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0001_init.sql
   ```
4. La commande affiche un résultat JSON confirmant la création des tables
   `events`, `categories`, `meta` et l'insertion des 6 catégories par
   défaut.

### Étape 7 — Redéployer et tester

1. Retournez dans l'onglet **Deployments** (Déploiements) de votre projet
   Pages et cliquez sur **Retry deployment** (Relancer le déploiement) sur
   le dernier déploiement — ou faites simplement un nouveau `git push`.
2. Ouvrez l'URL du site (affichée en haut du projet, du type
   `https://culturaficion-planning.pages.dev`).
3. Vous devez voir l'écran de saisie du code d'accès. Entrez le code défini
   à l'étape 5 : la frise doit se charger, vide, avec les 6 catégories par
   défaut visibles dans les filtres.
4. Ajoutez un événement de test, rechargez la page dans un autre
   navigateur/appareil : il doit apparaître pour tout le monde.

**C'est terminé.** Le site est en ligne, gratuit, avec des données en UE.

### (Facultatif) Nom de domaine personnalisé

Dans **Settings** → **Custom domains**, vous pouvez brancher un domaine à
vous (ex. `planning.culturaficion.fr`) si l'association en possède un.

---

## 3. Utilisation au quotidien

- **Code d'accès** : partagé, unique pour tout le bureau. Il est demandé une
  fois par navigateur/onglet (conservé en mémoire de session : il faut le
  ressaisir si l'onglet est fermé puis rouvert).
- **« Vous êtes »** : le prénom saisi dans ce champ reste mémorisé sur
  l'appareil utilisé (pour attribuer les propositions et les votes), il
  n'est pas partagé avec les autres membres.
- **Rafraîchir** : recharge les événements ajoutés par les autres membres
  depuis leur dernière visite.
- Pour changer le code d'accès plus tard : modifiez simplement la variable
  `ACCESS_CODE` dans les réglages Cloudflare Pages, puis redéployez (un
  nouveau déploiement applique la nouvelle valeur).

---

## 4. Développement local (facultatif, pour un développeur)

```
npm install
npm run dev          # interface seule (http://localhost:5173), sans API
```

Pour tester l'API et la base D1 en local (simulation Cloudflare) :

```
echo 'ACCESS_CODE=votre_code_de_test' > .dev.vars
npx wrangler d1 execute culturaficion_planning --local \
  --file=./migrations/0001_init.sql --persist-to=.wrangler/state
npm run pages:dev    # build + sert l'app avec l'API sur http://localhost:8788
```

`wrangler.toml` ne définit volontairement aucune liaison D1 : en production,
la liaison `DB` et `ACCESS_CODE` viennent du tableau de bord Cloudflare
Pages (voir étapes 4 et 5 ci-dessus), pas du dépôt.

---

## 5. Schéma de données (D1)

- `events` : `id`, `type`, `title`, `month_key`, `date`, `status`,
  `proposed_by`, `voters` (JSON), `notes`, `registered`, `revenue`,
  `expenses`, `created_at`.
- `categories` : `id`, `label`, `color`, `position`.
- `meta` : `key` / `value` (utilisé pour `startYear` et `startMonth`).

Voir `migrations/0001_init.sql` pour le détail et les catégories par défaut.

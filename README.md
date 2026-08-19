# Culturafición · Frise de la saison

Planning collaboratif des événements de l'association (soirées, conférences,
tentaderos prácticos, retransmissions, assemblée générale…), sous forme de
frise sur 12 mois. Interface « cartel taurin » (rouge, sable, or, encre),
partagée entre les membres du bureau via un code d'accès unique.

Cinq vues, accessibles via les boutons en haut de page :
- **Accueil** — recherche rapide, centrée, avec suggestions en direct ;
  cliquer sur une suggestion ouvre directement la fiche de l'événement.
- **Liste** — tous les événements, filtrables par nom, catégorie et statut.
- **Frise** — le planning sur 12 mois (vue historique, inchangée).
- **Adhésions** — saisie manuelle des adhérents (tendido / prácticos) saison
  par saison, avec totaux et historique comparatif (voir section 7).
- **Comptabilité** — journal des recettes/dépenses, compte de résultat et
  bilan assisté par exercice (septembre → août), avec export PDF/Excel pour
  l'assemblée générale (voir section 8). **Document de travail : assiste le
  trésorier, ne le remplace pas.**

Pas de vrai routeur d'URL — juste une bascule d'état côté client, plus
simple et plus robuste sur de l'hébergement statique. Les trois vues
partagent la même fiche de bilan (même composant, pas de duplication).

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

Dès que Cloudflare détecte un `wrangler.toml` dans le dépôt (c'est le cas
ici), l'onglet **Settings → Liaisons** du tableau de bord passe en lecture
seule avec le message *« Les liaisons de ce projet sont gérées via
wrangler.toml »* — la liaison D1 se définit donc directement dans ce fichier,
pas dans le tableau de bord.

1. Récupérez l'identifiant de votre base D1 depuis un terminal (avec
   `wrangler login` déjà fait, voir étape 6) :
   ```
   npx wrangler d1 info culturaficion_planning
   ```
   Notez la valeur `database_id` affichée (un UUID).
2. Dans le fichier `wrangler.toml` du dépôt, ajoutez :
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "culturaficion_planning"
   database_id = "VOTRE_DATABASE_ID"
   ```
3. Commitez et poussez ce changement — Cloudflare Pages redéploiera
   automatiquement avec la liaison active.

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
5. Le dossier `migrations/` peut contenir d'autres fichiers numérotés,
   ajoutés au fil des évolutions (ex. `0002_add_lieu.sql`). Appliquez-les
   **dans l'ordre des numéros**, avec la même commande :
   ```
   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0002_add_lieu.sql
   ```
   Une base déjà en place n'a besoin que des migrations qu'elle n'a pas
   encore reçues ; une base toute neuve doit tous les recevoir dans l'ordre.

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

La liaison D1 (`DB`) vient de `wrangler.toml` (voir étape 4 ci-dessus) ;
`ACCESS_CODE` reste un secret défini dans le tableau de bord Cloudflare
Pages (Settings → Variables et secrets), jamais commité dans le dépôt.

---

## 5. Schéma de données (D1)

- `events` : `id`, `type`, `title`, `month_key`, `date`, `lieu`,
  `helloasso_slug`, `status`, `proposed_by`, `voters` (JSON), `notes`,
  `registered`, `revenue`, `expenses`, `created_at`.
- `categories` : `id`, `label`, `color`, `position`.
- `meta` : `key` / `value` (utilisé pour `startYear` — seul réglage encore
  modifiable — et `startMonth`, conservé pour compatibilité mais toujours
  fixé à `8`/septembre par le code, plus réglable depuis l'interface).
- `memberships` : `id`, `first_name`, `last_name`, `type` (`tendido` ou
  `practicos`), `season_key`, `joined_date`, `created_at` (voir section 7).
- `acct_accounts`, `acct_entries`, `acct_balance` : plan de comptes, journal
  et éléments de bilan du module Comptabilité (voir section 8).

Voir `migrations/0001_init.sql` pour le détail et les catégories par défaut.

---

## 6. Intégration HelloAsso (billetterie)

Chaque événement peut porter un champ optionnel « Identifiant HelloAsso »
(le `formSlug` de sa billetterie). S'il est renseigné, la fiche bilan
appelle un endpoint serveur qui récupère, auprès de l'API HelloAsso, le
nombre d'inscriptions et les recettes validées, et les affiche à côté des
champs saisis à la main.

> **Piège fréquent : HelloAsso n'écrit jamais dans les champs Recettes/
> Dépenses.** « Inscrits HelloAsso » et « Recettes HelloAsso » sont des
> chiffres **purement informatifs**, recalculés en direct à chaque ouverture
> de la fiche — ils ne remplacent ni ne remplissent automatiquement les
> champs **Recettes (€)** / **Dépenses (€)** juste au-dessus. Ce sont ces
> deux champs-là (saisis à la main par le trésorier, en s'aidant au besoin
> du chiffre HelloAsso affiché à côté) qui comptent partout ailleurs dans
> l'app : « Net de saison » sur la Frise, et compte 7061/61 du module
> Comptabilité (section 8). Tant que « Recettes (€) » n'est pas rempli pour
> un événement, il contribue 0 € à ces totaux — même si HelloAsso affiche un
> montant à côté.

Aucun identifiant HelloAsso n'est exposé au frontend : tout passe par
l'endpoint serveur `GET /api/helloasso/:formSlug`, protégé par le même code
d'accès que le reste de l'app.

### Étape A — Créer les identifiants API sur HelloAsso

1. Connectez-vous sur [helloasso.com](https://www.helloasso.com) avec le
   compte de l'association.
2. Allez dans **Mon compte** → **Intégrations et API**.
3. Créez une clé API (« Créer une clé d'API » ou équivalent). HelloAsso vous
   donne un **Client ID** et un **Client secret** — copiez-les, ils ne sont
   affichés qu'une fois.
4. Si HelloAsso propose un environnement **sandbox** (bac à sable) pour
   tester sans toucher aux vraies billetteries, préférez-le pour les
   premiers essais ; sinon utilisez directement les identifiants de
   production (aucun risque : l'app ne fait que lire des chiffres agrégés).

### Étape B — Définir les variables d'environnement Cloudflare

Dans le tableau de bord Cloudflare Pages du projet → **Settings** →
**Environment variables**, ajoutez (comme pour `ACCESS_CODE` à l'étape 5) :

- `HELLOASSO_CLIENT_ID` (Secret) — le Client ID de l'étape A.
- `HELLOASSO_CLIENT_SECRET` (Secret) — le Client secret de l'étape A.
- `HELLOASSO_ORG_SLUG` — le nom de l'association tel qu'il apparaît dans
  l'URL HelloAsso (ex. pour `https://www.helloasso.com/associations/culturaficion`,
  la valeur est `culturaficion`).
- `HELLOASSO_FORM_TYPE` — probablement `Event`, à confirmer à l'étape C.
  Si la variable n'est pas définie, `Event` est utilisé par défaut.

Redéployez ensuite (un nouveau `git push` suffit) pour que ces variables
soient prises en compte.

### Étape C — Vérifier `formType` et l'état « validé »

Ces deux détails dépendent de la structure exacte des réponses HelloAsso et
sont à vérifier une fois avant la mise en production, avec un événement de
test ayant déjà une billetterie active :

1. Renseignez son `helloasso_slug` dans sa fiche (voir Étape D) et ouvrez sa
   fiche bilan. Si HelloAsso répond une erreur, le message « Données
   HelloAsso indisponibles » s'affiche — c'est le signe qu'il faut ajuster
   `HELLOASSO_FORM_TYPE` (essayez `Event`, puis d'autres valeurs si besoin :
   HelloAsso distingue plusieurs types de formulaires selon la nature de la
   billetterie).
2. Le code ne retient que les paiements dont l'état vaut `processed`
   (insensible à la casse) — c'est le nom d'état le plus courant pour un
   paiement validé chez HelloAsso. S'il s'avère que les chiffres affichés
   ne correspondent pas à ceux du tableau de bord HelloAsso pour cet
   événement de test, il faudra ajuster la constante `VALID_STATE` dans
   `functions/api/helloasso/[formSlug].js`.

### Étape D — Renseigner un événement et tester

1. Ouvrez (ou créez) un événement ayant déjà une billetterie HelloAsso
   active, cliquez sur **Modifier l'événement**.
2. Dans le champ **Identifiant HelloAsso (billetterie)**, renseignez le
   `formSlug` — le segment qui suit `/formulaire/` (ou similaire) dans
   l'URL publique de la billetterie sur HelloAsso.
3. Enregistrez, puis ouvrez la fiche bilan de cet événement : après un
   court chargement, **Inscrits HelloAsso** et **Recettes HelloAsso**
   doivent apparaître avec des valeurs cohérentes.
4. Comparez ces chiffres à ceux affichés dans le tableau de bord HelloAsso
   de l'association pour cette même billetterie.

### Migration à appliquer

```
npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0003_add_helloasso_slug.sql
```

---

## 7. Page Adhésions (saisie manuelle)

Le bureau gère les adhésions via Yapla, sans API disponible pour les
récupérer automatiquement. Cette page permet donc de **saisir les
adhésions à la main**, pour suivre leur évolution saison après saison.

- Deux types d'adhésion : **tendido** et **prácticos**. Une personne prenant
  les deux apparaît comme deux adhérents distincts (une ligne par type).
- Une **saison** va de septembre à août (ex. `2025-2026`) — **même sélecteur
  de saison que la Frise** (flèches précédent/suivant en haut de page) : il
  n'y a plus qu'un seul point de navigation entre saisons dans toute l'app.
  Le mois de départ est fixé à septembre partout, non réglable.
- Le formulaire « Ajouter un adhérent » garde son propre champ **saison**,
  éditable indépendamment (pré-rempli avec la saison affichée), pour
  permettre une saisie rétroactive sur une saison passée sans changer la
  saison affichée dans le reste de l'application.
- Champs saisis : prénom, nom, type, saison, date d'adhésion (facultative).
  Aucune autre donnée (pas d'email, téléphone, adresse, statut de
  paiement) : seules les données nécessaires à la gestion administrative de
  l'association sont conservées (RGPD, minimisation des données).
- La suppression d'un adhérent est immédiate, sans étape supplémentaire.
- Les données restent dans la même base D1 `culturaficion_planning`, déjà
  en juridiction UE — aucune infrastructure supplémentaire.

### Remise à niveau ponctuelle de `startMonth` (une seule fois)

Si un membre du bureau avait changé le mois de départ de la saison avant
cette mise à jour, la base peut encore contenir une valeur différente de
`8`. Elle est ignorée par l'application (le mois de départ est maintenant
toujours septembre) et se corrige d'elle-même à la prochaine navigation
entre saisons, mais vous pouvez la remettre à niveau tout de suite avec :

```
npx wrangler d1 execute culturaficion_planning --remote --command="UPDATE meta SET value = '8' WHERE key = 'startMonth';"
```

### Endpoints

- `GET /api/memberships?season=2025-2026` — liste des adhérents de la saison.
- `POST /api/memberships` — ajoute un adhérent.
- `PUT /api/memberships/:id` — modifie un adhérent.
- `DELETE /api/memberships/:id` — supprime un adhérent.
- `GET /api/memberships/summary` — totaux `tendido` / `practicos` pour
  chaque saison présente en base (alimente l'historique comparatif).
- `GET /api/memberships/non-renewed` — pour chaque type, les adhérents
  ayant eu ce type une saison passée mais aucune adhésion (tout type
  confondu) pour la saison en cours ; alimente la section « À relancer ».

Protégés par le même code d'accès (`ACCESS_CODE`) que le reste de l'app.

### Migration à appliquer

```
npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0004_add_memberships.sql
```

### Section « À relancer » (adhérents non renouvelés)

Sous la liste et les totaux de la page Adhésions, une section calcule
automatiquement, pour chaque type, les adhérents qui avaient ce type une
saison passée mais n'ont repris **aucune** adhésion (tendido ou prácticos)
pour la saison en cours. Dès qu'une personne reprend une cotisation —
même dans l'autre type — elle sort de toutes les listes.

La saison en cours est calculée automatiquement côté serveur à partir de
la date du jour (pas de réglage manuel). Le rapprochement d'une saison à
l'autre se fait par prénom + nom (insensible à la casse, espaces
superflus ignorés) : la table `memberships` n'ayant pas d'identifiant
unique par personne, un nom saisi différemment d'une année sur l'autre ne
sera pas rapproché correctement — limite connue et acceptée.

Aucune migration supplémentaire : cette section ne fait que croiser les
données déjà en base.

---

## 8. Page Comptabilité (assistée)

Le trésorier tient les comptes selon un **plan comptable associatif**
(comptes de classe 7 pour les produits, classe 6 pour les charges), sur un
**exercice de septembre à août** (même sélecteur de saison unique que la
Frise et les Adhésions).

> **Important** : ce module **assiste** le trésorier, il ne prétend pas
> produire des comptes certifiés. Chaque écran garde la mention « Document
> de travail — à valider par le trésorier ». Le trésorier garde la main sur
> chaque ligne et valide les états avant l'assemblée générale.

### D'où viennent les chiffres

Deux sources bien distinctes :

- **Les événements de la Frise** alimentent **automatiquement** deux
  comptes : **7061** (somme des recettes des événements de l'exercice) et
  **61** (somme des dépenses). Un événement appartient à l'exercice via son
  mois (`month_key`) : l'exercice `2025-2026` couvre septembre 2025 → août
  2026. Ces deux comptes sont donc **en lecture seule** dans le journal — ils
  apparaissent détaillés par événement, avec la mention « Depuis la Frise »
  et un lien vers l'événement ; on ne les modifie qu'en éditant l'événement
  dans la Frise.
  > Précisément, ce sont les champs **Recettes (€)** / **Dépenses (€)** de la
  > fiche événement qui comptent ici — **pas** « Recettes HelloAsso », qui
  > n'est qu'un affichage informatif à côté (voir le piège décrit en
  > section 6). Un événement dont « Recettes (€) » est encore vide contribue
  > 0 € à 7061, même si sa billetterie HelloAsso a déjà encaissé de l'argent.
- **Tout le reste** (cotisations, subventions, dons, ventes, assurances,
  fournitures, frais bancaires…) se **saisit à la main** dans le journal,
  rattaché à un poste et à un exercice. La saisie sur un exercice passé est
  possible (champ exercice éditable dans le formulaire).

### Les 4 sous-vues

1. **Journaux** — liste des opérations (recettes et dépenses), filtrable ;
   ajout/modification/suppression pour les écritures manuelles, lecture
   seule pour les lignes issues des événements. Bouton **Postes** pour
   renommer ou masquer un poste (comme les catégories de la Frise) — masquer
   ne supprime jamais les écritures déjà saisies.
2. **Résultat** — compte de résultat calculé automatiquement : produits par
   poste, charges par poste, sous-totaux, résultat net mis en avant (vert si
   excédent, rouge si déficit).
3. **Bilan** — trésorerie de clôture calculée (`trésorerie d'ouverture +
   recettes − dépenses`), fonds propres reportés + résultat de l'exercice,
   compléments d'actif/passif saisis à la main, et un contrôle d'équilibre
   (« Équilibré ✅ » / « Écart de X € ⚠️ », non bloquant). Dans le cas simple
   d'une compta de trésorerie, `fonds propres reportés = trésorerie
   d'ouverture` et le bilan s'équilibre naturellement.
4. **Export** — export du compte de résultat + bilan de l'exercice affiché,
   en PDF (génération via l'impression du navigateur, mise en page sobre) et
   en Excel/CSV (aucune bibliothèque tierce, génération 100 % côté client).

### Plan de comptes par défaut (seed)

| Code | Libellé | Alimentation |
|------|---------|--------------|
| 7562 | Cotisations adhérents | manuelle |
| 741 | Subvention d'exploitation | manuelle |
| 75411 | Dons (sans contrepartie) | manuelle |
| 7061 | Prestations de services / frais soirées & animations | **auto — Frise** |
| 7071 | Vente de marchandises | manuelle |
| 76 | Produits financiers | manuelle |
| 61 | Règlement prestation soirée & événements | **auto — Frise** |
| 605 | Autres fournitures | manuelle |
| 6213 | Rémunérations intermédiaires et honoraires | manuelle |
| 6161 | Assurances | manuelle |
| 6238 | Dons et aides à autres associations | manuelle |
| 60 | Divers (participation aux frais des practicos & éleveurs) | manuelle |
| 607 | Achat marchandises | manuelle |
| 6231 | Publicité, publications (banderole/sticker/panuelo) | manuelle |
| 6247 | Déplacements, missions et réceptions (toreros) | manuelle |
| 6278 | Services bancaires, autres | manuelle |
| 64 | Charges de personnel / charges sociales | manuelle |
| 67 | Charges exceptionnelles | manuelle |

### Endpoints

- `GET /api/accounting/accounts` — liste du plan de comptes.
- `POST /api/accounting/accounts` — ajoute un poste manuel.
- `PUT /api/accounting/accounts/:code` — renomme ou masque/démasque un poste.
- `DELETE /api/accounting/accounts/:code` — supprime un poste manuel non
  utilisé (refusé pour 7061/61 et pour un poste déjà utilisé par des
  écritures — masquez-le plutôt).
- `GET /api/accounting/entries?exercise=2025-2026` — journal complet
  (écritures manuelles + recettes/dépenses des événements de la Frise).
- `POST /api/accounting/entries` — ajoute une écriture manuelle.
- `PUT /api/accounting/entries/:id` / `DELETE /api/accounting/entries/:id` —
  modifie/supprime une écriture manuelle (les lignes issues d'événements
  n'existent pas dans cette table et ne peuvent donc pas être touchées ici).
- `GET /api/accounting/result?exercise=2025-2026` — compte de résultat
  calculé (total par poste + résultat net).
- `GET /api/accounting/balance?exercise=2025-2026` /
  `PUT /api/accounting/balance?exercise=2025-2026` — lit/enregistre les
  soldes d'ouverture et compléments de bilan de l'exercice.

Protégés par le même code d'accès (`ACCESS_CODE`) que le reste de l'app.

### Migration à appliquer

```
npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0005_add_accounting.sql
```

Cette migration crée uniquement les tables `acct_accounts`, `acct_entries`
et `acct_balance` (avec le plan de comptes ci-dessus déjà inséré) — elle ne
touche à aucune table existante (`events`, `categories`, `meta`,
`memberships`).

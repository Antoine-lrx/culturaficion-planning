-- Migration additive : ajoute la colonne `city` (ville) à la table ganaderias.
-- Permet d'afficher la ville sur les tuiles de la liste des ganaderías.
-- À appliquer avec :
--   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0008_add_ganaderia_city.sql
--
-- La colonne est nullable : les ganaderías déjà enregistrées auront `city`
-- à NULL, et l'affichage gère ce cas sans planter (la ligne « ville » est
-- simplement masquée). La ville est pré-remplie automatiquement depuis la
-- réponse Nominatim lors de la géolocalisation, ou saisie à la main.

ALTER TABLE ganaderias ADD COLUMN city TEXT;

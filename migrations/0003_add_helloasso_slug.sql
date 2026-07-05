-- Migration additive : ajoute l'identifiant de billetterie HelloAsso à un événement.
-- À appliquer avec :
--   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0003_add_helloasso_slug.sql
--
-- Sur une base déjà en place, cette migration ajoute simplement la colonne
-- sans toucher aux données existantes (nullable, sans valeur par défaut).

ALTER TABLE events ADD COLUMN helloasso_slug TEXT;

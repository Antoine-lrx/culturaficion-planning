-- Migration additive : ajoute le champ "lieu" à un événement.
-- À appliquer avec :
--   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0002_add_lieu.sql
--
-- Sur une base déjà en place (créée avec 0001_init.sql), cette migration
-- ajoute simplement la colonne sans toucher aux données existantes.

ALTER TABLE events ADD COLUMN lieu TEXT;

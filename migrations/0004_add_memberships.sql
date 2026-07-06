-- Migration additive : ajoute la table des adhésions saisies manuellement.
-- À appliquer avec :
--   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0004_add_memberships.sql
--
-- Sur une base déjà en place, cette migration crée uniquement la nouvelle
-- table `memberships` et son index, sans toucher aux tables existantes
-- (events, categories, meta).

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('tendido', 'practicos')),
  season_key TEXT NOT NULL,        -- ex. "2025-2026"
  joined_date TEXT,                -- ISO date, facultatif
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memberships_season ON memberships(season_key);

-- Migration additive : ajoute la table de l'annuaire des ganaderías
-- (prospection de la branche Prácticos), utilisée par la page « Ganaderías ».
-- À appliquer avec :
--   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0007_add_ganaderias.sql
--
-- Sur une base déjà en place, cette migration crée uniquement la nouvelle
-- table `ganaderias` et ses index, sans toucher aux tables existantes
-- (events, categories, meta, memberships, acct_accounts, acct_entries,
-- acct_balance).

CREATE TABLE IF NOT EXISTS ganaderias (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL CHECK (country IN ('france', 'espagne')),
  address TEXT,
  latitude REAL,
  longitude REAL,
  status TEXT NOT NULL DEFAULT 'a_contacter'
    CHECK (status IN ('a_contacter', 'en_attente', 'partenaire')),
  contact_name TEXT,
  contact_phone TEXT,
  contact_instagram TEXT,
  last_contact_date TEXT,   -- date ISO, facultatif
  comments TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ganaderias_country ON ganaderias(country);
CREATE INDEX IF NOT EXISTS idx_ganaderias_status ON ganaderias(status);

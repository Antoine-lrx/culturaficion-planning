-- Schéma initial de la base culturaficion_planning.
-- À appliquer avec :
--   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  month_key   TEXT NOT NULL,
  date        TEXT,
  status      TEXT NOT NULL DEFAULT 'idee',
  proposed_by TEXT,
  voters      TEXT NOT NULL DEFAULT '[]',
  notes       TEXT,
  registered  INTEGER,
  revenue     REAL,
  expenses    REAL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id       TEXT PRIMARY KEY,
  label    TEXT NOT NULL,
  color    TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_month_key ON events (month_key);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);

-- Catégories par défaut (couleurs d'origine de la frise).
INSERT OR IGNORE INTO categories (id, label, color, position) VALUES
  ('soiree',         'Soirée',              '#BB322C', 0),
  ('conference',     'Conférence',          '#355E8A', 1),
  ('tentadero',      'Tentadero práctico',  '#4A7A3F', 2),
  ('retransmission', 'Retransmission',      '#1F8A8A', 3),
  ('ag',             'Assemblée générale',  '#8A5A2E', 4),
  ('autre',          'Autre',               '#6B6258', 5);

-- Saison par défaut : septembre 2026 -> août 2027 (à ajuster depuis l'écran de réglages).
INSERT OR IGNORE INTO meta (key, value) VALUES
  ('startYear', '2026'),
  ('startMonth', '8');

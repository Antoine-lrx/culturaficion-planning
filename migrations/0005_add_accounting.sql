-- Migration additive : ajoute le module Comptabilité (plan de comptes,
-- journal des opérations manuelles, éléments de bilan par exercice).
-- À appliquer avec :
--   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0005_add_accounting.sql
--
-- Sur une base déjà en place, cette migration crée uniquement les nouvelles
-- tables `acct_accounts`, `acct_entries` et `acct_balance` et leurs index,
-- sans toucher aux tables existantes (events, categories, meta, memberships).

CREATE TABLE IF NOT EXISTS acct_accounts (
  code TEXT PRIMARY KEY,          -- ex. "7562", "61", "6161"
  label TEXT NOT NULL,            -- ex. "Cotisations adhérents"
  kind TEXT NOT NULL CHECK (kind IN ('produit','charge')),
  auto_source TEXT,               -- NULL = manuel ; "events" pour 7061 et 61
  position INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS acct_entries (
  id TEXT PRIMARY KEY,
  exercise_key TEXT NOT NULL,     -- ex. "2025-2026"
  op_date TEXT,                   -- date ISO, facultative
  kind TEXT NOT NULL CHECK (kind IN ('produit','charge')),
  account_code TEXT NOT NULL,     -- vers acct_accounts.code
  label TEXT NOT NULL,            -- libellé libre
  amount REAL NOT NULL,           -- montant positif
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acct_entries_ex ON acct_entries(exercise_key);

CREATE TABLE IF NOT EXISTS acct_balance (
  exercise_key TEXT PRIMARY KEY,
  opening_treasury REAL DEFAULT 0,   -- trésorerie en début d'exercice
  opening_funds REAL DEFAULT 0,      -- fonds propres reportés (= trésorerie d'ouverture dans le cas simple)
  manual_assets TEXT,                -- JSON [{label, amount}] : compléments d'actif (matériel, créances…)
  manual_liabilities TEXT            -- JSON [{label, amount}] : compléments de passif (dettes…)
);

-- Plan de comptes du trésorier (produits classe 7, charges classe 6).
-- 7061 et 61 sont alimentés automatiquement par les événements de la Frise
-- (auto_source = 'events') : ils ne sont jamais saisis à la main.
INSERT OR IGNORE INTO acct_accounts (code, label, kind, auto_source, position, hidden) VALUES
  ('7562',  'Cotisations adhérents',                                        'produit', NULL,     0, 0),
  ('741',   'Subvention d''exploitation',                                   'produit', NULL,     1, 0),
  ('75411', 'Dons (sans contrepartie)',                                     'produit', NULL,     2, 0),
  ('7061',  'Prestations de services / frais soirées & animations',         'produit', 'events', 3, 0),
  ('7071',  'Vente de marchandises',                                        'produit', NULL,     4, 0),
  ('76',    'Produits financiers',                                         'produit', NULL,     5, 0),
  ('61',    'Règlement prestation soirée & événements',                     'charge',  'events', 0, 0),
  ('605',   'Autres fournitures',                                           'charge',  NULL,     1, 0),
  ('6213',  'Rémunérations intermédiaires et honoraires',                   'charge',  NULL,     2, 0),
  ('6161',  'Assurances',                                                   'charge',  NULL,     3, 0),
  ('6238',  'Dons et aides à autres associations',                          'charge',  NULL,     4, 0),
  ('60',    'Divers (participation aux frais des practicos & éleveurs)',    'charge',  NULL,     5, 0),
  ('607',   'Achat marchandises',                                           'charge',  NULL,     6, 0),
  ('6231',  'Publicité, publications (banderole/sticker/panuelo)',          'charge',  NULL,     7, 0),
  ('6247',  'Déplacements, missions et réceptions (toreros)',               'charge',  NULL,     8, 0),
  ('6278',  'Services bancaires, autres',                                   'charge',  NULL,     9, 0),
  ('64',    'Charges de personnel / charges sociales',                      'charge',  NULL,    10, 0),
  ('67',    'Charges exceptionnelles',                                      'charge',  NULL,    11, 0);

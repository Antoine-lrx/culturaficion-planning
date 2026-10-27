-- Migration additive : inscrits des événements HelloAsso et liste d'opposition.
-- À appliquer avec :
--   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0010_add_event_attendees.sql
--
-- Crée uniquement deux nouvelles tables, sans toucher aux tables existantes.
-- Données personnelles minimales (prénom, nom, email, statut de relance),
-- supprimées automatiquement 12 mois après l'événement (voir README §RGPD).

CREATE TABLE IF NOT EXISTS event_attendees (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  helloasso_item_id TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  email_source TEXT CHECK (email_source IN ('participant', 'payeur', 'payeur_tiers')),
  payer_name TEXT,                 -- rempli seulement si email_source = 'payeur_tiers'
  is_member INTEGER NOT NULL DEFAULT 0,
  member_match TEXT CHECK (member_match IN ('email', 'nom')),
  follow_up_status TEXT CHECK (follow_up_status IN ('a_relancer', 'relance', 'ne_plus_contacter')),
  followed_up_at INTEGER,
  absent INTEGER NOT NULL DEFAULT 0,
  -- 1 dès que la case « absent » a été modifiée à la main : la mise à jour
  -- depuis HelloAsso (billets scannés) ne la touche plus.
  absent_manual INTEGER NOT NULL DEFAULT 0,
  retrieved_at INTEGER NOT NULL,
  UNIQUE (event_id, helloasso_item_id)
);
CREATE INDEX IF NOT EXISTS idx_attendees_event ON event_attendees(event_id);

CREATE TABLE IF NOT EXISTS contact_optouts (
  email_hash TEXT PRIMARY KEY,     -- SHA-256 de l'email normalisé (minuscules, sans espaces)
  created_at INTEGER NOT NULL
);

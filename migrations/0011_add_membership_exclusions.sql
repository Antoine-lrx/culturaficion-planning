-- Migration additive : retraits manuels des listes « Perdus de vue » et
-- « Venus sans adhérer » (page Adhésions).
-- À appliquer avec :
--   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0011_add_membership_exclusions.sql
--
-- Crée uniquement une nouvelle table et son index, sans toucher aux tables
-- existantes. Aucune donnée personnelle en clair : person_key est l'empreinte
-- SHA-256 (hexadécimal) du prénom + nom normalisés (fonction partagée
-- normalizePersonName), sur le même principe que contact_optouts.
-- Pas de texte libre : le motif est choisi dans une liste fermée.

CREATE TABLE IF NOT EXISTS membership_exclusions (
  id TEXT PRIMARY KEY,
  list_key TEXT NOT NULL CHECK (list_key IN ('perdus_de_vue', 'venus_sans_adherer')),
  person_key TEXT NOT NULL,        -- SHA-256 du prénom + nom normalisés
  season_key TEXT,                 -- saison du retrait ; NULL = retrait permanent
  reason TEXT NOT NULL CHECK (reason IN ('readhere_autrement', 'ne_plus_afficher', 'autre')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exclusions_list ON membership_exclusions(list_key, season_key);

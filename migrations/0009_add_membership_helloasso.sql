-- Migration additive : enrichit la table `memberships` pour l'intégration
-- HelloAsso des adhésions (récupération automatique de la saison en cours),
-- SANS reconstruire la table ni toucher aux données existantes.
-- À appliquer avec :
--   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0009_add_membership_helloasso.sql
--
-- Principe : on n'AJOUTE que des colonnes. La colonne `type` conserve ses
-- deux valeurs (tendido / practicos) et sa contrainte CHECK. Les quatre
-- tarifs ne sont pas quatre types : ce sont deux types × deux tarifs
-- (plein / jeune). Toute la logique existante (totaux, historique,
-- non-renouvelés) continue de fonctionner sans modification.
--
-- Toutes les lignes existantes héritent de source='manuel', tarif=NULL et
-- amount=NULL : on ne réécrit pas l'historique et on n'invente aucun
-- montant rétroactif.

ALTER TABLE memberships ADD COLUMN tarif TEXT;                              -- 'plein' | 'jeune' | NULL
ALTER TABLE memberships ADD COLUMN amount REAL;                            -- montant en euros, NULL si inconnu
ALTER TABLE memberships ADD COLUMN source TEXT NOT NULL DEFAULT 'manuel';  -- 'manuel' | 'helloasso'
ALTER TABLE memberships ADD COLUMN helloasso_item_id TEXT;                 -- identifiant de l'article HelloAsso
ALTER TABLE memberships ADD COLUMN tier_name TEXT;                         -- libellé brut du tarif HelloAsso
ALTER TABLE memberships ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;  -- pierre tombale RGPD (voir README §RGPD)

-- Un article HelloAsso ne peut correspondre qu'à une seule ligne. L'index
-- partiel ignore les lignes manuelles (helloasso_item_id NULL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_ha_item
  ON memberships(helloasso_item_id) WHERE helloasso_item_id IS NOT NULL;

-- Accélère le graphique d'évolution mensuelle (regroupement par date d'adhésion).
CREATE INDEX IF NOT EXISTS idx_memberships_joined ON memberships(joined_date);

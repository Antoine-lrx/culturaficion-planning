-- Migration additive : ajoute le report à nouveau automatique du bilan
-- (chaînage d'un exercice à l'autre) et la clôture d'exercice.
-- À appliquer avec :
--   npx wrangler d1 execute culturaficion_planning --remote --file=./migrations/0006_accounting_opening_chain.sql
--
-- N'ajoute que des colonnes à la table acct_balance existante (créée par
-- 0005_add_accounting.sql), sans toucher à aucune autre table.

ALTER TABLE acct_balance ADD COLUMN opening_source TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE acct_balance ADD COLUMN closed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE acct_balance ADD COLUMN closed_at INTEGER;
-- Trésorerie et fonds propres de clôture, figés au moment de la clôture de
-- l'exercice (voir POST /api/accounting/close) : permettent de reporter une
-- valeur stable à l'exercice suivant même si une écriture antérieure est
-- modifiée par erreur après coup.
ALTER TABLE acct_balance ADD COLUMN closing_treasury REAL;
ALTER TABLE acct_balance ADD COLUMN closing_funds REAL;

-- Les exercices déjà saisis avant cette migration avaient une ouverture
-- saisie à la main (comportement de l'ancien module) : on les marque
-- explicitement 'manual' pour ne rien changer à leurs chiffres existants.
UPDATE acct_balance SET opening_source = 'manual' WHERE opening_treasury IS NOT NULL OR opening_funds IS NOT NULL;

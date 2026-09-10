// Helpers partagés par les endpoints /api/accounting/*.
import { safeParseArray } from "./serialize.js";

// Postes du plan comptable associatif standard (classes 6 et 7) absents de la
// base historique. Ils vivent en constantes de code — aucune migration SQL —
// et complètent le plan à l'affichage comme à la saisie : un poste-constante
// n'apparaît en base (acct_entries) que le jour où une écriture le référence.
export const EXTRA_ACCOUNTS = [
  // Produits (classe 7)
  { code: "7135", label: "Variation des stocks de produits",             kind: "produit" },
  { code: "7561", label: "Cotisations sans contrepartie (art. 200 CGI)", kind: "produit" },
  { code: "77",   label: "Produits exceptionnels",                       kind: "produit" },
  { code: "78",   label: "Reprises sur amortissements et provisions",    kind: "produit" },
  { code: "79",   label: "Transfert de charges",                         kind: "produit" },
  // Charges (classe 6)
  { code: "6037", label: "Variation des stocks de marchandises",         kind: "charge" },
  { code: "611",  label: "Locations mobilières et immobilières",         kind: "charge" },
  { code: "6260", label: "Frais postaux et de télécommunications",       kind: "charge" },
  { code: "63",   label: "Impôts et taxes",                              kind: "charge" },
  { code: "641",  label: "Rémunération du personnel",                    kind: "charge" },
  { code: "65",   label: "Autres charges de gestion courante",           kind: "charge" },
  { code: "66",   label: "Charges financières",                          kind: "charge" },
  { code: "68",   label: "Dotation aux amortissements et provisions",    kind: "charge" },
];

// Familles du plan comptable, identifiées par les deux premiers chiffres du
// code (60x → 60, 6161 → 61, 75411 → 75…). L'ordre de cette liste fixe l'ordre
// d'affichage des familles dans la vue regroupée du compte de résultat.
export const ACCOUNT_FAMILIES = {
  charge: [
    { code: "60", label: "Achats" },
    { code: "61", label: "Services extérieurs" },
    { code: "62", label: "Autres services extérieurs" },
    { code: "63", label: "Impôts et taxes" },
    { code: "64", label: "Charges de personnel" },
    { code: "65", label: "Autres charges de gestion courante" },
    { code: "66", label: "Charges financières" },
    { code: "67", label: "Charges exceptionnelles" },
    { code: "68", label: "Dotation aux amortissements et provisions" },
  ],
  produit: [
    { code: "70", label: "Ventes et prestations" },
    { code: "74", label: "Subventions d'exploitation" },
    { code: "75", label: "Autres produits de gestion courante" },
    { code: "76", label: "Produits financiers" },
    { code: "77", label: "Produits exceptionnels" },
    { code: "78", label: "Reprises sur amortissements et provisions" },
    { code: "79", label: "Transfert de charges" },
  ],
};

// La famille se déduit des deux premiers chiffres du code, sauf pour de rares
// postes dont le préfixe ne colle pas à la famille voulue (ex. 7135 —
// variation des stocks — se range avec les ventes 70, pas 71).
const FAMILY_OVERRIDES = { "7135": "70" };
export const familyCode = (code) => FAMILY_OVERRIDES[code] || String(code || "").slice(0, 2);

// Résout un poste par code, qu'il soit stocké en base OU fourni en constante
// (postes-constantes du plan standard). Renvoie un objet au même format qu'une
// ligne de acct_accounts (code, label, kind, auto_source…) ou null si inconnu.
// Indispensable à la saisie : sans lui, affecter une écriture à un poste-
// constante (ex. 611) échouerait avec « Poste comptable introuvable ».
export async function resolveAccountByCode(env, code) {
  const row = await env.DB.prepare("SELECT * FROM acct_accounts WHERE code = ?").bind(code).first();
  if (row) return row;
  const extra = EXTRA_ACCOUNTS.find((a) => a.code === code);
  if (extra) return { code: extra.code, label: extra.label, kind: extra.kind, auto_source: null, position: null, hidden: 0, extra: 1 };
  return null;
}

// Fusionne le plan stocké en base (source de vérité pour les libellés, l'ordre
// et l'état masqué des postes existants) avec les postes-constantes : chaque
// poste-constante absent de la base est ajouté en fin de sa classe et marqué
// `extra: 1`, sans jamais écraser un poste homonyme déjà en base.
export function mergeAccountRows(rows) {
  const byCode = new Set(rows.map((r) => r.code));
  const maxPos = { produit: -1, charge: -1 };
  for (const r of rows) {
    if (r.kind in maxPos) maxPos[r.kind] = Math.max(maxPos[r.kind], Number(r.position) || 0);
  }
  const merged = rows.map((r) => ({ ...r, extra: 0 }));
  for (const x of EXTRA_ACCOUNTS) {
    if (byCode.has(x.code)) continue;
    maxPos[x.kind] += 1;
    merged.push({
      code: x.code, label: x.label, kind: x.kind,
      auto_source: null, position: maxPos[x.kind], hidden: 0, extra: 1,
    });
  }
  return merged;
}

// Regroupe des lignes de compte de résultat par famille (2 premiers chiffres),
// dans l'ordre de ACCOUNT_FAMILIES, avec le sous-total de chaque famille. Une
// famille sans aucun poste rattaché est omise ; un code hors nomenclature
// tombe dans une famille « Divers » de secours, ordonnée après les familles
// connues, pour ne jamais perdre une ligne.
function buildGroups(lines, kind) {
  const fams = ACCOUNT_FAMILIES[kind] || [];
  const groups = fams.map((f) => ({ code: f.code, label: f.label, subtotal: 0, lines: [] }));
  const byCode = new Map(groups.map((g) => [g.code, g]));
  const fallback = [];
  for (const l of lines) {
    const fc = familyCode(l.code);
    let g = byCode.get(fc);
    if (!g) {
      g = { code: fc, label: "Divers", subtotal: 0, lines: [] };
      byCode.set(fc, g);
      fallback.push(g);
    }
    g.lines.push(l);
    g.subtotal += l.total;
  }
  fallback.sort((a, b) => a.code.localeCompare(b.code));
  return groups.concat(fallback).filter((g) => g.lines.length > 0);
}

// Un exercice ("2025-2026") va de septembre de l'année de départ à août de
// l'année suivante. Les month_key des événements sont au format "YYYY-MM",
// qui trie lexicographiquement comme une date : on peut donc borner
// l'exercice avec une simple comparaison de chaînes en SQL.
export function exerciseBounds(exerciseKey) {
  const y1 = Number(String(exerciseKey).split("-")[0]);
  return { start: `${y1}-09`, end: `${y1 + 1}-08` };
}

export function isValidExerciseKey(exerciseKey) {
  return typeof exerciseKey === "string" && /^\d{4}-\d{4}$/.test(exerciseKey);
}

export function previousExerciseKey(exerciseKey) {
  const y1 = Number(String(exerciseKey).split("-")[0]);
  return `${y1 - 1}-${y1}`;
}

// Les événements de la Frise alimentent automatiquement 7061 (recettes) et
// 61 (dépenses) : on les représente comme des écritures en lecture seule,
// une par événement et par sens, détaillées (pas de double saisie possible).
export async function getEventEntries(env, exerciseKey) {
  const { start, end } = exerciseBounds(exerciseKey);
  const rows = await env.DB.prepare(
    "SELECT id, title, month_key, date, revenue, expenses FROM events WHERE month_key >= ? AND month_key <= ? ORDER BY month_key ASC, date ASC"
  ).bind(start, end).all();

  const entries = [];
  for (const r of rows.results) {
    if (r.revenue != null) {
      entries.push({
        id: `event:${r.id}:revenue`,
        exerciseKey,
        opDate: r.date,
        kind: "produit",
        accountCode: "7061",
        label: r.title,
        amount: Number(r.revenue),
        source: "event",
        eventId: r.id,
        monthKey: r.month_key,
      });
    }
    if (r.expenses != null) {
      entries.push({
        id: `event:${r.id}:expense`,
        exerciseKey,
        opDate: r.date,
        kind: "charge",
        accountCode: "61",
        label: r.title,
        amount: Number(r.expenses),
        source: "event",
        eventId: r.id,
        monthKey: r.month_key,
      });
    }
  }
  return entries;
}

// Compte des cotisations alimenté automatiquement par les adhésions HelloAsso.
const MEMBERSHIP_ACCOUNT_CODE = "7562";
const MONTHS_LONG_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Bornes JOUR d'un exercice ("2026-2027" → 2026-09-01 … 2027-08-31), au format
// AAAA-MM-JJ qui se compare lexicographiquement comme une date.
function exerciseDayBounds(exerciseKey) {
  const y1 = Number(String(exerciseKey).split("-")[0]);
  return { exStart: `${y1}-09-01`, exEnd: `${y1 + 1}-08-31` };
}

// SOURCE UNIQUE des montants de cotisations d'une saison (point 3). Utilisée à
// la fois par l'endpoint de la page Adhésions et par la génération des lignes
// automatiques du compte 7562 : les deux partagent donc exactement les mêmes
// chiffres, au centime près, par construction.
//
// Périmètre comptable HelloAsso : source='helloasso', is_deleted=0, montant non
// nul, season_key = exercice (tous les articles helloasso stockés sont des
// Membership reconnus — dons et libellés inconnus ne sont jamais écrits en base).
// Les adhésions manuelles restent HORS comptabilité (décision du bureau).
export async function getMembershipRevenue(env, seasonKey) {
  const { exStart, exEnd } = exerciseDayBounds(seasonKey);

  const [haRes, manRow, noAmtRow, donRow] = await Promise.all([
    env.DB.prepare(
      `SELECT amount, joined_date FROM memberships
        WHERE source = 'helloasso' AND is_deleted = 0 AND amount IS NOT NULL AND season_key = ?`
    ).bind(seasonKey).all(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM memberships
        WHERE source = 'manuel' AND is_deleted = 0 AND amount IS NOT NULL AND season_key = ?`
    ).bind(seasonKey).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM memberships
        WHERE is_deleted = 0 AND amount IS NULL AND season_key = ?`
    ).bind(seasonKey).first(),
    env.DB.prepare("SELECT value FROM meta WHERE key = ?").bind(`helloasso_membership_donations:${seasonKey}`).first(),
  ]);

  // Répartition des lignes HelloAsso : par mois (dans l'exercice), avant
  // l'ouverture (réglées avant le 1er sept), après la clôture (cas rare).
  const byMonth = new Map();
  let before = { total: 0, count: 0 };
  let after = { total: 0, count: 0 };
  for (const r of haRes.results) {
    const amt = Number(r.amount) || 0;
    const jd = r.joined_date ? String(r.joined_date) : null;
    if (!jd || jd < exStart) {
      before.total += amt;
      before.count += 1;
    } else if (jd > exEnd) {
      after.total += amt;
      after.count += 1;
    } else {
      const mk = jd.slice(0, 7); // AAAA-MM
      const acc = byMonth.get(mk) || { total: 0, count: 0 };
      acc.total += amt;
      acc.count += 1;
      byMonth.set(mk, acc);
    }
  }

  const byMonthArr = [...byMonth.entries()]
    .map(([monthKey, v]) => ({ monthKey, total: round2(v.total), count: v.count }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  // Les lignes 7562 sont construites ICI pour que X (page Adhésions) = somme
  // des lignes automatiques 7562, par construction.
  const entries = buildMembershipEntries(seasonKey, byMonthArr, before, after);
  const helloassoTotal = round2(entries.reduce((s, e) => s + e.amount, 0));
  const helloassoCount = entries.reduce((s, e) => s + e.count, 0);

  let donations = { count: 0, total: 0 };
  if (donRow?.value) {
    try {
      const p = JSON.parse(donRow.value);
      donations = { count: Number(p.count) || 0, total: round2(p.total) };
    } catch {
      /* valeur illisible : on affiche zéro don plutôt que de planter */
    }
  }

  return {
    season: seasonKey,
    entries,
    helloasso: { total: helloassoTotal, count: helloassoCount },
    manual: { total: round2(manRow?.total), count: Number(manRow?.count) || 0 },
    noAmountCount: Number(noAmtRow?.count) || 0,
    before: { total: round2(before.total), count: before.count },
    after: { total: round2(after.total), count: after.count },
    byMonth: byMonthArr,
    donations,
  };
}

// Construit les lignes automatiques du compte 7562 à partir de la répartition
// calculée par getMembershipRevenue. UNE ligne par mois (datée du dernier jour
// du mois), plus au besoin une ligne « avant l'ouverture » (datée du 1er sept)
// et une ligne « après la clôture » (datée du 31 août). Agréger par mois évite
// des dizaines de lignes illisibles.
function buildMembershipEntries(exerciseKey, byMonthArr, before, after) {
  const y1 = Number(String(exerciseKey).split("-")[0]);
  const plural = (n) => (n > 1 ? "s" : "");
  const entries = [];

  for (const { monthKey, total, count } of byMonthArr) {
    const y = Number(monthKey.slice(0, 4));
    const m = Number(monthKey.slice(5, 7)); // 1-based
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    entries.push({
      id: `membership:${exerciseKey}:${monthKey}`,
      exerciseKey,
      opDate: `${monthKey}-${String(lastDay).padStart(2, "0")}`,
      kind: "produit",
      accountCode: MEMBERSHIP_ACCOUNT_CODE,
      label: `Cotisations HelloAsso — ${MONTHS_LONG_FR[m - 1]} ${y} (${count} adhésion${plural(count)})`,
      amount: total,
      source: "membership",
      monthKey,
      count,
    });
  }

  if (before.count > 0) {
    entries.push({
      id: `membership:${exerciseKey}:before`,
      exerciseKey,
      opDate: `${y1}-09-01`,
      kind: "produit",
      accountCode: MEMBERSHIP_ACCOUNT_CODE,
      label: `Cotisations HelloAsso — réglées avant l'ouverture de l'exercice (${before.count} adhésion${plural(before.count)})`,
      amount: round2(before.total),
      source: "membership",
      count: before.count,
    });
  }

  if (after.count > 0) {
    entries.push({
      id: `membership:${exerciseKey}:after`,
      exerciseKey,
      opDate: `${y1 + 1}-08-31`,
      kind: "produit",
      accountCode: MEMBERSHIP_ACCOUNT_CODE,
      label: `Cotisations HelloAsso — réglées après la clôture de l'exercice (${after.count} adhésion${plural(after.count)})`,
      amount: round2(after.total),
      source: "membership",
      count: after.count,
    });
  }

  return entries.sort((a, b) => a.opDate.localeCompare(b.opDate));
}

// Lignes automatiques du compte 7562 pour le journal et le compte de résultat.
// Simple façade sur getMembershipRevenue : la source de vérité est unique.
export async function getMembershipEntries(env, exerciseKey) {
  const revenue = await getMembershipRevenue(env, exerciseKey);
  return revenue.entries;
}

// Un exercice a-t-il la moindre trace en base (bilan, écritures ou
// événements) ? Sert à distinguer le tout premier exercice suivi (aucune
// donnée avant lui) d'un exercice simplement pas encore renseigné.
async function exerciseHasData(env, exerciseKey) {
  const { start, end } = exerciseBounds(exerciseKey);
  const [balanceRow, entryRow, eventRow] = await Promise.all([
    env.DB.prepare("SELECT 1 FROM acct_balance WHERE exercise_key = ?").bind(exerciseKey).first(),
    env.DB.prepare("SELECT 1 FROM acct_entries WHERE exercise_key = ? LIMIT 1").bind(exerciseKey).first(),
    env.DB.prepare("SELECT 1 FROM events WHERE month_key >= ? AND month_key <= ? LIMIT 1").bind(start, end).first(),
  ]);
  return Boolean(balanceRow || entryRow || eventRow);
}

// Résout l'ouverture (trésorerie + fonds propres) d'un exercice : reportée
// automatiquement de la clôture de l'exercice précédent (report à nouveau),
// sauf si le trésorier a forcé une valeur manuelle pour cet exercice précis.
// Remonte récursivement la chaîne jusqu'au premier exercice suivi, dont
// l'ouverture est nécessairement saisie à la main (rien à reporter avant).
export async function resolveOpening(env, exerciseKey, depth = 0) {
  if (depth > 60) {
    // Garde-fou : chaîne anormalement longue (ou en boucle). On arrête là
    // plutôt que de saturer les requêtes D1.
    return { openingTreasury: 0, openingFunds: 0, source: "manual", fromExercise: null, needsFirstEntry: false };
  }

  const row = await env.DB.prepare("SELECT * FROM acct_balance WHERE exercise_key = ?").bind(exerciseKey).first();
  if (row && row.opening_source === "manual") {
    return {
      openingTreasury: row.opening_treasury || 0,
      openingFunds: row.opening_funds || 0,
      source: "manual",
      fromExercise: null,
      needsFirstEntry: false,
    };
  }

  const prevKey = previousExerciseKey(exerciseKey);
  const prevHasData = await exerciseHasData(env, prevKey);
  if (!prevHasData) {
    return { openingTreasury: 0, openingFunds: 0, source: "none", fromExercise: null, needsFirstEntry: true };
  }

  const prevRow = await env.DB.prepare("SELECT * FROM acct_balance WHERE exercise_key = ?").bind(prevKey).first();

  let prevClosingTreasury;
  let prevClosingFunds;
  if (prevRow && prevRow.closed) {
    // Exercice précédent clôturé : ses chiffres sont figés au moment de la
    // clôture, on les reprend tels quels même si une écriture y a été
    // modifiée par erreur depuis.
    prevClosingTreasury = prevRow.closing_treasury || 0;
    prevClosingFunds = prevRow.closing_funds || 0;
  } else {
    const [prevOpening, prevResult] = await Promise.all([
      resolveOpening(env, prevKey, depth + 1),
      computeResult(env, prevKey),
    ]);
    prevClosingTreasury = prevOpening.openingTreasury + prevResult.totalProduits - prevResult.totalCharges;
    prevClosingFunds = prevOpening.openingFunds + prevResult.net;
  }

  return { openingTreasury: prevClosingTreasury, openingFunds: prevClosingFunds, source: "auto", fromExercise: prevKey, needsFirstEntry: false };
}

// Bilan complet calculé d'un exercice : ouverture (reportée automatiquement
// ou saisie/ajustée à la main), trésorerie et fonds propres de clôture,
// compléments manuels d'actif/passif et contrôle d'équilibre actif = passif.
export async function computeBalance(env, exerciseKey) {
  const y1 = Number(String(exerciseKey).split("-")[0]);
  const nextSeasonKey = `${y1 + 1}-${y1 + 2}`;
  const [row, opening, result, nextRevenue] = await Promise.all([
    env.DB.prepare("SELECT * FROM acct_balance WHERE exercise_key = ?").bind(exerciseKey).first(),
    resolveOpening(env, exerciseKey),
    computeResult(env, exerciseKey),
    // Transparence (point 1) : cotisations de la saison SUIVANTE encaissées
    // avant le 1er sept — présentes en banque à la clôture de cet exercice,
    // mais rattachées à l'exercice suivant. Simple affichage : aucun chiffre
    // du bilan n'est modifié, et cela fonctionne même si l'exercice est clôturé.
    getMembershipRevenue(env, nextSeasonKey),
  ]);

  const manualAssets = safeParseArray(row?.manual_assets);
  const manualLiabilities = safeParseArray(row?.manual_liabilities);
  const sumLines = (lines) => lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const closed = Boolean(row?.closed);
  // Une fois clôturé, on réaffiche la trésorerie/fonds propres de clôture
  // figés au moment de la clôture plutôt que de les recalculer en direct :
  // les chiffres présentés à l'AG ne bougent plus, même si une écriture
  // antérieure est modifiée par erreur après coup.
  const closingTreasury = closed ? (row.closing_treasury || 0) : opening.openingTreasury + result.totalProduits - result.totalCharges;
  const closingFunds = closed ? (row.closing_funds || 0) : opening.openingFunds + result.net;
  const totalActif = closingTreasury + sumLines(manualAssets);
  const totalPassif = closingFunds + sumLines(manualLiabilities);

  return {
    exercise: exerciseKey,
    openingTreasury: opening.openingTreasury,
    openingFunds: opening.openingFunds,
    openingSource: opening.source,
    openingFromExercise: opening.fromExercise,
    needsFirstEntry: opening.needsFirstEntry,
    closingTreasury,
    closingFunds,
    net: result.net,
    manualAssets,
    manualLiabilities,
    totalActif,
    totalPassif,
    diff: totalActif - totalPassif,
    balanced: Math.abs(totalActif - totalPassif) < 0.01,
    closed,
    closedAt: row?.closed_at || null,
    // Mention informative (point 1) : { total, count } des cotisations de la
    // saison suivante encaissées avant le 1er septembre. À n'afficher que si
    // total > 0.
    nextSeasonEarly: { total: nextRevenue.before.total, count: nextRevenue.before.count },
    nextSeasonKey,
  };
}

// Compte de résultat de l'exercice : total par poste (produits, charges),
// en agrégeant les écritures manuelles et les recettes/dépenses des
// événements de la Frise, plus le résultat net.
export async function computeResult(env, exerciseKey) {
  const [accountsRes, manualRes, eventEntries, membershipEntries] = await Promise.all([
    env.DB.prepare("SELECT * FROM acct_accounts ORDER BY position ASC").all(),
    env.DB.prepare(
      "SELECT account_code, SUM(amount) AS total FROM acct_entries WHERE exercise_key = ? GROUP BY account_code"
    ).bind(exerciseKey).all(),
    getEventEntries(env, exerciseKey),
    getMembershipEntries(env, exerciseKey),
  ]);

  const totals = {};
  for (const row of manualRes.results) totals[row.account_code] = (totals[row.account_code] || 0) + Number(row.total || 0);
  for (const e of eventEntries) totals[e.accountCode] = (totals[e.accountCode] || 0) + e.amount;
  for (const e of membershipEntries) totals[e.accountCode] = (totals[e.accountCode] || 0) + e.amount;

  const accounts = mergeAccountRows(accountsRes.results);
  const toLine = (a) => ({ code: a.code, label: a.label, hidden: !!a.hidden, extra: !!a.extra, total: totals[a.code] || 0 });
  const produits = accounts.filter((a) => a.kind === "produit").map(toLine);
  const charges = accounts.filter((a) => a.kind === "charge").map(toLine);
  const totalProduits = produits.reduce((s, a) => s + a.total, 0);
  const totalCharges = charges.reduce((s, a) => s + a.total, 0);

  return {
    exercise: exerciseKey,
    produits,
    charges,
    totalProduits,
    totalCharges,
    net: totalProduits - totalCharges,
    // Vue regroupée : mêmes lignes, organisées en familles avec sous-totaux.
    // Les deux vues partagent donc rigoureusement les mêmes chiffres.
    groups: {
      produit: buildGroups(produits, "produit"),
      charge: buildGroups(charges, "charge"),
    },
  };
}

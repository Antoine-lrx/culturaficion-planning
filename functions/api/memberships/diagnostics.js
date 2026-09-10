import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { getAccessToken, centsToEuros, HELLOASSO_API_BASE as API_BASE } from "../../_lib/helloasso.js";
import { seasonFromSlug, isValidSeasonKey } from "../../_lib/season.js";

// OUTIL DE DIAGNOSTIC TEMPORAIRE (lecture seule, aucune écriture).
// GET /api/memberships/diagnostics — aide à comprendre pourquoi une adhésion
// HelloAsso n'apparaît pas. RGPD : AUCUNE donnée personnelle n'est renvoyée
// (ni nom, ni prénom, ni email). Uniquement : identifiants d'articles, types,
// états, dates, montants et season_key. À RETIRER une fois le diagnostic fait.

const KNOWN_TIERS = new Set([
  "tendido",
  "practico",
  "tendido - jeune (-30 ans)",
  "practico - jeune (-30 ans)",
]);

function normalizeTier(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function pickDate(it) {
  const raw = (it.order && it.order.date) || it.orderDate || it.date || null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function fetchAllItems(env, token, states) {
  const out = [];
  let cont = "";
  let page = 0;
  const SIZE = 100;
  const MAX = 50;
  do {
    page += 1;
    const url = new URL(`${API_BASE}/organizations/${env.HELLOASSO_ORG_SLUG}/forms/Membership/${env.HELLOASSO_MEMBERSHIP_FORM_SLUG}/items`);
    url.searchParams.set("pageSize", String(SIZE));
    for (const s of states) url.searchParams.append("itemStates", s);
    if (cont) url.searchParams.set("continuationToken", cont);
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const b = await res.text().catch(() => "");
      throw new Error(`items ${res.status}: ${b.slice(0, 150)}`);
    }
    const data = await res.json();
    const arr = data.data || [];
    out.push(...arr);
    cont = arr.length === SIZE ? (data.pagination && data.pagination.continuationToken) || "" : "";
  } while (cont && page < MAX);
  return out;
}

export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const fromSlug = seasonFromSlug(env.HELLOASSO_MEMBERSHIP_FORM_SLUG);
  const fromEnv = isValidSeasonKey(env.HELLOASSO_MEMBERSHIP_SEASON) ? String(env.HELLOASSO_MEMBERSHIP_SEASON).trim() : null;
  const formSeason = fromSlug && fromEnv && fromSlug !== fromEnv ? null : fromSlug || fromEnv || null;

  // Lignes HelloAsso en base (anonymisées).
  const rowsRes = await env.DB.prepare(
    "SELECT helloasso_item_id, season_key, is_deleted, amount, joined_date FROM memberships WHERE source = 'helloasso'"
  ).all();
  const rows = rowsRes.results.map((r) => ({
    itemId: String(r.helloasso_item_id),
    seasonKey: r.season_key,
    isDeleted: r.is_deleted,
    hasAmount: r.amount != null,
    joinedDate: r.joined_date,
  }));
  const rowIds = new Set(rows.map((r) => r.itemId));

  // Articles HelloAsso, tous états, pour repérer l'article manquant.
  let items = null;
  let apiError = null;
  try {
    if (env.HELLOASSO_CLIENT_ID && env.HELLOASSO_CLIENT_SECRET && env.HELLOASSO_ORG_SLUG && env.HELLOASSO_MEMBERSHIP_FORM_SLUG) {
      const token = await getAccessToken(env);
      // États d'ARTICLE valides côté HelloAsso (les états Authorized/Refunded…
      // sont des états de PAIEMENT, refusés ici par l'API).
      const states = ["Processed", "Registered", "Unregistered", "Canceled"];
      const raw = await fetchAllItems(env, token, states);
      items = raw
        .map((it) => {
          const type = it.type ?? null;
          const isMembershipType = type === null || type === "" || type === "Membership";
          return {
            id: String(it.id),
            type,
            state: it.state ?? null,
            date: pickDate(it),
            amountEur: centsToEuros(it.amount),
            tierName: it.name ?? "",
            mapped: isMembershipType && KNOWN_TIERS.has(normalizeTier(it.name)),
            inDb: rowIds.has(String(it.id)),
          };
        })
        .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    }
  } catch (e) {
    apiError = e && e.message ? e.message.slice(0, 200) : "erreur inconnue";
  }

  return json({
    formSeason,
    fromSlug,
    fromEnv,
    formSlugConfigured: Boolean(env.HELLOASSO_MEMBERSHIP_FORM_SLUG),
    dbRowCount: rows.length,
    tombstoneCount: rows.filter((r) => r.isDeleted).length,
    rows,
    itemCount: items ? items.length : null,
    items,
    apiError,
  });
}

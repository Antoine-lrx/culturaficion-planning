import { json } from "../../../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../../../_lib/auth.js";
import { getAccessToken, HELLOASSO_API_BASE as API_BASE } from "../../../../_lib/helloasso.js";
import { normalizePersonName } from "../../../../_lib/people.js";

// ─────────────────────────────────────────────────────────────────────────
// OUTIL DE DIAGNOSTIC TEMPORAIRE — à retirer avant la mise en ligne de la
// section « Inscrits ». Lecture seule, rien n'est écrit en base.
//
// GET /api/events/:id/attendees/diagnostic — lit les billets HelloAsso de
// l'événement et ne renvoie QUE des compteurs et des libellés : nombre de
// billets par état, types et libellés de tarifs, libellés des champs
// personnalisés (avec le nombre de réponses et le nombre de réponses ayant
// la forme d'un email), noms des champs présents dans la réponse. Aucun nom,
// aucune adresse, aucune réponse de champ personnalisé n'est renvoyé.
// ─────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
// États d'ARTICLE acceptés par l'endpoint items (doc officielle HelloAsso).
const ITEM_STATES = ["Processed", "Registered", "Unknown", "Canceled"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestGet({ request, env, params }) {
  if (!isAuthorized(request, env)) return unauthorized();
  const headers = { "cache-control": "no-store" };

  const ev = await env.DB.prepare("SELECT helloasso_slug FROM events WHERE id = ?").bind(params.id).first();
  if (!ev) return json({ error: "Événement introuvable." }, { status: 404, headers });
  if (!ev.helloasso_slug) {
    return json({ error: "Ajoute l'identifiant HelloAsso de l'événement pour récupérer les inscrits." }, { status: 400, headers });
  }
  if (!env.HELLOASSO_CLIENT_ID || !env.HELLOASSO_CLIENT_SECRET || !env.HELLOASSO_ORG_SLUG) {
    return json({ error: "Intégration HelloAsso non configurée." }, { status: 503, headers });
  }

  const formType = env.HELLOASSO_FORM_TYPE || "Event";
  const formSlug = ev.helloasso_slug;

  let items;
  try {
    const token = await getAccessToken(env);
    items = await fetchAll(env, token, formType, formSlug);
  } catch (err) {
    // Message technique (statut HTTP, chemin) sans aucune donnée personnelle.
    return json({ error: "Appel HelloAsso en échec.", detail: String(err && err.message).slice(0, 300) }, { status: 502, headers });
  }

  const byState = {};
  const typesByState = {};
  const freeByState = {};
  const tiers = new Map();
  const paymentStates = {};
  const priceCategories = {};
  const itemKeys = new Set();
  const userKeys = new Set();
  const payerKeys = new Set();
  const customFields = new Map();
  const orders = new Map();
  let userIsPayer = 0;
  let userDiffersFromPayer = 0;
  let userMissing = 0;
  let payerEmailPresent = 0;
  let retained = 0;

  for (const it of items) {
    const state = String(it.state || "(vide)");
    const type = String(it.type || "(vide)");
    byState[state] = (byState[state] || 0) + 1;
    typesByState[state] = typesByState[state] || {};
    typesByState[state][type] = (typesByState[state][type] || 0) + 1;
    if (!(Number(it.amount) > 0)) freeByState[state] = (freeByState[state] || 0) + 1;
    Object.keys(it).forEach((k) => itemKeys.add(k));
    if (it.user) Object.keys(it.user).forEach((k) => userKeys.add(k));
    if (it.payer) Object.keys(it.payer).forEach((k) => payerKeys.add(k));

    const tierKey = `${state}|${type}|${it.name || ""}|${it.priceCategory || ""}`;
    const tier = tiers.get(tierKey) || { state, type, tierName: it.name || "", priceCategory: it.priceCategory || null, count: 0 };
    tier.count += 1;
    tiers.set(tierKey, tier);

    if (state !== "Processed" && state !== "Registered") continue;
    retained += 1;

    for (const p of it.payments || []) {
      const ps = String(p.state || "(vide)");
      paymentStates[ps] = (paymentStates[ps] || 0) + 1;
    }
    const pc = String(it.priceCategory || "(vide)");
    priceCategories[pc] = (priceCategories[pc] || 0) + 1;

    const orderId = it.order && it.order.id != null ? String(it.order.id) : `item-${it.id}`;
    orders.set(orderId, (orders.get(orderId) || 0) + 1);

    const u = it.user || {};
    const p = it.payer || {};
    if (p.email) payerEmailPresent += 1;
    if (!u.firstName && !u.lastName) {
      userMissing += 1;
    } else if (normalizePersonName(u.firstName, u.lastName) === normalizePersonName(p.firstName, p.lastName)) {
      userIsPayer += 1;
    } else {
      userDiffersFromPayer += 1;
    }

    for (const cf of it.customFields || []) {
      const label = String(cf.name || "(sans libellé)");
      const key = `${label}|${cf.type || ""}`;
      const entry = customFields.get(key) || { label, type: cf.type || null, answered: 0, looksLikeEmail: 0 };
      const answer = cf.answer != null ? String(cf.answer).trim() : "";
      if (answer) entry.answered += 1;
      if (EMAIL_RE.test(answer)) entry.looksLikeEmail += 1;
      customFields.set(key, entry);
    }
  }

  const orderSizes = [...orders.values()];
  return json(
    {
      formType,
      formSlug,
      totalItems: items.length,
      byState,
      typesByState,
      freeByState,
      tiers: [...tiers.values()],
      retained: {
        items: retained,
        orders: orderSizes.length,
        ordersWithSeveralTickets: orderSizes.filter((n) => n > 1).length,
        priceCategories,
        paymentStates,
        userIsPayer,
        userDiffersFromPayer,
        userMissing,
        payerEmailPresent,
      },
      customFields: [...customFields.values()],
      fieldNames: { item: [...itemKeys].sort(), user: [...userKeys].sort(), payer: [...payerKeys].sort() },
    },
    { headers }
  );
}

async function fetchAll(env, token, formType, formSlug) {
  const out = [];
  let continuationToken = "";
  let page = 0;
  do {
    page += 1;
    const url = new URL(`${API_BASE}/organizations/${env.HELLOASSO_ORG_SLUG}/forms/${formType}/${formSlug}/items`);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    url.searchParams.set("withDetails", "true");
    for (const s of ITEM_STATES) url.searchParams.append("itemStates", s);
    if (continuationToken) url.searchParams.set("continuationToken", continuationToken);

    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Appel à ${url.pathname} en échec (statut ${res.status}) : ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const items = data.data || [];
    out.push(...items);
    continuationToken =
      items.length === PAGE_SIZE ? (data.pagination && data.pagination.continuationToken) || "" : "";
  } while (continuationToken && page < MAX_PAGES);
  return out;
}

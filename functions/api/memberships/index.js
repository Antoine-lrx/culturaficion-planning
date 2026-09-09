import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { rowToMembership } from "../../_lib/serialize.js";

const TYPES = ["tendido", "practicos"];
const TARIFS = ["plein", "jeune"]; // NULL autorisé (« Non précisé »)

// GET /api/memberships?season=2025-2026 — liste des adhérents d'une saison.
// Les pierres tombales RGPD (is_deleted = 1) sont exclues de tout affichage.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const url = new URL(request.url);
  const season = url.searchParams.get("season");
  if (!season) return json({ error: "Paramètre 'season' requis." }, { status: 400 });

  const rows = await env.DB.prepare(
    "SELECT * FROM memberships WHERE season_key = ? AND is_deleted = 0 ORDER BY last_name COLLATE NOCASE ASC, first_name COLLATE NOCASE ASC"
  ).bind(season).all();

  return json(rows.results.map(rowToMembership));
}

// POST /api/memberships — ajoute un adhérent saisi à la main (source='manuel').
// tarif (plein/jeune/null) et amount (facultatif) viennent enrichir la saisie.
export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  const { id, firstName, lastName, type, seasonKey, joinedDate } = body || {};
  if (!id || !firstName || !lastName || !type || !seasonKey) {
    return json({ error: "Champs requis manquants (id, firstName, lastName, type, seasonKey)." }, { status: 400 });
  }
  if (!TYPES.includes(type)) {
    return json({ error: "Type d'adhésion invalide (tendido ou practicos)." }, { status: 400 });
  }

  // tarif : 'plein', 'jeune' ou null (« Non précisé »).
  const tarif = body.tarif == null || body.tarif === "" ? null : body.tarif;
  if (tarif !== null && !TARIFS.includes(tarif)) {
    return json({ error: "Tarif invalide (plein, jeune ou non précisé)." }, { status: 400 });
  }
  // amount : montant facultatif. Refusé s'il est fourni mais invalide.
  let amount = null;
  if (body.amount != null && body.amount !== "") {
    amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return json({ error: "Montant invalide : indiquez un nombre positif ou laissez vide." }, { status: 400 });
    }
  }

  const createdAt = Date.now();
  await env.DB.prepare(
    `INSERT INTO memberships (id, first_name, last_name, type, tarif, amount, source, season_key, joined_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'manuel', ?, ?, ?)`
  ).bind(id, firstName.trim(), lastName.trim(), type, tarif, amount, seasonKey, joinedDate || null, createdAt).run();

  const row = await env.DB.prepare("SELECT * FROM memberships WHERE id = ?").bind(id).first();
  return json(rowToMembership(row), { status: 201 });
}

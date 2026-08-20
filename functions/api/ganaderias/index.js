import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { rowToGanaderia } from "../../_lib/serialize.js";
import { geocodeAddress } from "../../_lib/geocode.js";

const COUNTRIES = ["france", "espagne"];
const STATUSES = ["a_contacter", "en_attente", "partenaire"];

// GET /api/ganaderias?country=france — liste les ganaderías d'un pays.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const url = new URL(request.url);
  const country = url.searchParams.get("country");
  if (!country) return json({ error: "Paramètre 'country' requis." }, { status: 400 });
  if (!COUNTRIES.includes(country)) {
    return json({ error: "Pays invalide (france ou espagne)." }, { status: 400 });
  }

  const rows = await env.DB.prepare(
    "SELECT * FROM ganaderias WHERE country = ? ORDER BY name COLLATE NOCASE ASC"
  ).bind(country).all();

  return json(rows.results.map(rowToGanaderia));
}

// POST /api/ganaderias — ajoute une ganadería (géolocalisation côté serveur
// si une adresse est fournie et qu'aucune coordonnée manuelle n'est saisie).
export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }

  const {
    id, name, country, address, status, contactName, contactPhone,
    contactInstagram, lastContactDate, comments,
  } = body || {};
  let { latitude, longitude } = body || {};

  if (!id || !name || !country) {
    return json({ error: "Champs requis manquants (id, name, country)." }, { status: 400 });
  }
  if (!COUNTRIES.includes(country)) {
    return json({ error: "Pays invalide (france ou espagne)." }, { status: 400 });
  }
  const finalStatus = status || "a_contacter";
  if (!STATUSES.includes(finalStatus)) {
    return json({ error: "Statut invalide." }, { status: 400 });
  }

  let geocodingFailed = false;
  const hasManualCoords = latitude != null && longitude != null && latitude !== "" && longitude !== "";
  if (address && !hasManualCoords) {
    const geo = await geocodeAddress(address, country);
    if (geo) {
      latitude = geo.latitude;
      longitude = geo.longitude;
    } else {
      latitude = null;
      longitude = null;
      geocodingFailed = true;
    }
  } else if (!hasManualCoords) {
    latitude = null;
    longitude = null;
  }

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO ganaderias (id, name, country, address, latitude, longitude, status, contact_name, contact_phone, contact_instagram, last_contact_date, comments, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, name.trim(), country, address || null,
    latitude != null ? Number(latitude) : null, longitude != null ? Number(longitude) : null,
    finalStatus, contactName || null, contactPhone || null, contactInstagram || null,
    lastContactDate || null, comments || null, now, now
  ).run();

  const row = await env.DB.prepare("SELECT * FROM ganaderias WHERE id = ?").bind(id).first();
  const result = rowToGanaderia(row);
  if (geocodingFailed) result.geocodingFailed = true;
  return json(result, { status: 201 });
}

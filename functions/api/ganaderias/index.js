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
    id, name, country, address, city, status, contactName, contactPhone,
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

  // Une ganadería peut être enregistrée avec ou sans coordonnées : si la
  // géolocalisation échoue, latitude/longitude restent à null et la
  // sauvegarde aboutit quand même (l'utilisateur pourra positionner le
  // marqueur à la main ensuite).
  let finalCity = typeof city === "string" && city.trim() ? city.trim() : null;
  let geocodingFailed = false;
  const hasManualCoords = latitude != null && longitude != null && latitude !== "" && longitude !== "";
  if (address && !hasManualCoords) {
    const geo = await geocodeAddress(address, country);
    if (geo) {
      latitude = geo.latitude;
      longitude = geo.longitude;
      if (!finalCity && geo.city) finalCity = geo.city;
    } else {
      latitude = null;
      longitude = null;
      geocodingFailed = true;
    }
  } else if (!hasManualCoords) {
    latitude = null;
    longitude = null;
  }

  try {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO ganaderias (id, name, country, address, city, latitude, longitude, status, contact_name, contact_phone, contact_instagram, last_contact_date, comments, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, name.trim(), country, address || null, finalCity,
      latitude != null ? Number(latitude) : null, longitude != null ? Number(longitude) : null,
      finalStatus, contactName || null, contactPhone || null, contactInstagram || null,
      lastContactDate || null, comments || null, now, now
    ).run();
  } catch (e) {
    // Cas le plus fréquent : l'id existe déjà (l'enregistrement a en fait
    // réussi lors d'une première tentative). On renvoie un 409 explicite au
    // lieu d'un 500 opaque, pour que le frontend bascule sur une mise à jour.
    const msg = String(e && e.message || e);
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(msg)) {
      return json({ error: "Cette ganadería existe déjà. Rechargez la liste puis modifiez-la." }, { status: 409 });
    }
    return json({ error: "Enregistrement impossible : " + msg }, { status: 500 });
  }

  const row = await env.DB.prepare("SELECT * FROM ganaderias WHERE id = ?").bind(id).first();
  const result = rowToGanaderia(row);
  if (geocodingFailed) result.geocodingFailed = true;
  return json(result, { status: 201 });
}

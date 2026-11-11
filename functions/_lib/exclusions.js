// Retraits manuels des listes « Perdus de vue » et « Venus sans adhérer »
// (table membership_exclusions, migration 0011).
//
// RGPD : aucune donnée personnelle en clair. Une personne est identifiée par
// l'empreinte SHA-256 de son prénom + nom normalisés (normalizePersonName),
// la même clé de rapprochement que les deux listes. Les noms affichés dans
// « Retirés manuellement » sont retrouvés à la lecture, en comparant ces
// empreintes aux données déjà présentes. Pas de texte libre : motif fermé.
import { currentSeasonKey } from "./season.js";
import { normalizePersonName } from "./people.js";

export const LIST_KEYS = ["perdus_de_vue", "venus_sans_adherer"];
export const REASONS = ["readhere_autrement", "ne_plus_afficher", "autre"];
// Seul « Ne plus afficher » est permanent ; les autres motifs ne valent que
// pour la saison en cours.
export const PERMANENT_REASONS = new Set(["ne_plus_afficher"]);

export const isPersonKey = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

// Empreinte SHA-256 (hexadécimal) d'une clé de personne déjà normalisée.
export async function personKeyHash(normalizedKey) {
  const data = new TextEncoder().encode(normalizedKey);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const personKeyFor = (firstName, lastName) => personKeyHash(normalizePersonName(firstName, lastName));

// Retraits actifs d'une liste : permanents, ou posés pour la saison en cours.
// Les retraits d'une saison passée sont ignorés (et nettoyés au prochain ajout).
// Si la table n'existe pas encore (migration 0011 pas appliquée), on renvoie
// une liste vide : les listes existantes continuent de fonctionner.
export async function loadActiveExclusions(env, listKey) {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, list_key, person_key, season_key, reason, created_at
         FROM membership_exclusions
        WHERE list_key = ?1 AND (season_key IS NULL OR season_key = ?2)
        ORDER BY created_at DESC`
    ).bind(listKey, currentSeasonKey()).all();
    return rows.results;
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return [];
    throw e;
  }
}

export function rowToExclusion(r) {
  return {
    id: r.id,
    list: r.list_key,
    seasonKey: r.season_key ?? null,
    permanent: r.season_key == null,
    reason: r.reason,
    createdAt: r.created_at,
  };
}

// Sépare une liste de personnes (chacune portant déjà `personKey`) entre
// visibles et retirées. Renvoie aussi les ids des retraits orphelins (aucune
// personne de `knownKeys` ne correspond), que l'appelant peut nettoyer.
export function splitByExclusions(people, exclusions, knownKeys) {
  const byKey = new Map();
  for (const ex of exclusions) if (!byKey.has(ex.person_key)) byKey.set(ex.person_key, ex);
  const visible = [];
  const excluded = [];
  for (const p of people) {
    const ex = byKey.get(p.personKey);
    if (ex) excluded.push({ ...p, exclusion: rowToExclusion(ex) });
    else visible.push(p);
  }
  const orphanIds = knownKeys
    ? exclusions.filter((ex) => !knownKeys.has(ex.person_key)).map((ex) => ex.id)
    : [];
  return { visible, excluded, orphanIds };
}

// Supprime des retraits orphelins (la personne n'existe plus dans les
// données : suppression RGPD, purge à 12 mois…). N'écrit rien si la liste est vide.
export async function deleteExclusions(env, ids) {
  if (!ids.length) return;
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(", ");
  await env.DB.prepare(`DELETE FROM membership_exclusions WHERE id IN (${placeholders})`).bind(...ids).run();
}

// Tri alphabétique par nom puis prénom, insensible aux accents et à la casse.
export const compareByName = (lastA, firstA, lastB, firstB) =>
  String(lastA || "").localeCompare(String(lastB || ""), "fr", { sensitivity: "base" }) ||
  String(firstA || "").localeCompare(String(firstB || ""), "fr", { sensitivity: "base" });

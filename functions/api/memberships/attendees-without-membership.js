import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { currentSeasonKey } from "../../_lib/season.js";
import { normalizePersonName } from "../../_lib/people.js";
import { jsonNoStore, purgeExpired, loadMemberNames, loadOptouts, emailHash } from "../../_lib/attendees.js";

// Date du jour à Paris (AAAA-MM-JJ) : un événement du soir compte bien comme
// « du jour » même après minuit UTC.
function parisToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Clé de tri chronologique d'un événement : sa date, à défaut son mois.
const eventSortKey = (ev) => ev.date || ev.monthKey || "";

// GET /api/memberships/attendees-without-membership — lecture seule.
// Personnes venues à au moins un événement passé (ou du jour) de la saison en
// cours sans y être adhérentes. Relit uniquement les inscrits déjà récupérés
// (event_attendees) : aucun appel HelloAsso, aucune écriture hors purge RGPD.
//
// Une personne = prénom + nom normalisés (égalité stricte). Adhérente si son
// nom figure dans les adhésions de la saison en cours, ou si une de ses lignes
// a été reconnue par email pendant cette saison. Exclus : lignes « absent »,
// et toute personne en « ne plus contacter » ou dans la liste d'opposition.
// La réponse ne contient aucun email ; rien n'est journalisé.
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();
  await purgeExpired(env);

  const season = currentSeasonKey();
  const y1 = Number(season.split("-")[0]);
  const seasonEndDay = `${y1 + 1}-08-31`;
  const today = parisToday();
  const lastDay = today < seasonEndDay ? today : seasonEndDay;
  const seasonStartMs = Date.UTC(y1, 8, 1);

  // Événements passés de la saison, avec leurs inscrits s'il y en a (LEFT
  // JOIN : un événement sans inscrits récupérés sert à la ligne de couverture).
  const [rowsRes, memberNames, optouts] = await Promise.all([
    env.DB.prepare(
      `SELECT e.id AS event_id, e.title, e.date, e.month_key, e.helloasso_slug,
              a.id AS att_id, a.first_name, a.last_name, a.email, a.is_member, a.member_match,
              a.follow_up_status, a.absent, a.retrieved_at
         FROM events e
         LEFT JOIN event_attendees a ON a.event_id = e.id
        WHERE (e.date IS NOT NULL AND e.date <> '' AND e.date >= ?1 AND e.date <= ?2)
           OR ((e.date IS NULL OR e.date = '') AND e.month_key >= ?3 AND e.month_key <= ?4)`
    ).bind(`${y1}-09-01`, lastDay, `${y1}-09`, lastDay.slice(0, 7)).all(),
    loadMemberNames(env),
    loadOptouts(env),
  ]);

  const events = new Map();
  const people = new Map();
  const optedOut = new Set();
  let rowsWithoutName = 0;

  for (const r of rowsRes.results) {
    let ev = events.get(r.event_id);
    if (!ev) {
      ev = {
        id: r.event_id,
        title: r.title,
        date: r.date || null,
        monthKey: r.month_key,
        hasHelloAsso: Boolean(r.helloasso_slug && String(r.helloasso_slug).trim()),
        retrieved: false,
      };
      events.set(r.event_id, ev);
    }
    if (!r.att_id) continue;
    ev.retrieved = true;
    if (r.absent) continue;

    const refused =
      r.follow_up_status === "ne_plus_contacter" ||
      Boolean(r.email && optouts.size && optouts.has(await emailHash(r.email)));
    const key = normalizePersonName(r.first_name, r.last_name);
    if (!key) {
      if (!refused) rowsWithoutName += 1;
      continue;
    }
    if (refused) {
      optedOut.add(key);
      continue;
    }

    let p = people.get(key);
    if (!p) {
      p = { key, firstName: "", lastName: "", nameRank: "", events: new Map(), emailMember: false };
      people.set(key, p);
    }
    p.events.set(ev.id, ev);
    // Nom affiché : celui de la ligne la plus récente (événement, puis récupération).
    const rank = `${eventSortKey(ev)}|${String(r.retrieved_at || 0).padStart(15, "0")}`;
    if (rank >= p.nameRank) {
      p.nameRank = rank;
      p.firstName = r.first_name || "";
      p.lastName = r.last_name || "";
    }
    if (r.is_member && r.member_match === "email" && Number(r.retrieved_at) >= seasonStartMs) p.emailMember = true;
  }
  for (const key of optedOut) people.delete(key);

  let members = 0;
  const nonMembers = [];
  for (const p of people.values()) {
    if (memberNames.has(p.key) || p.emailMember) {
      members += 1;
      continue;
    }
    const evs = [...p.events.values()].sort((a, b) => eventSortKey(b).localeCompare(eventSortKey(a)));
    nonMembers.push({
      firstName: p.firstName,
      lastName: p.lastName,
      eventCount: evs.length,
      lastEventDate: eventSortKey(evs[0]) || null,
      events: evs.map((e) => ({ id: e.id, title: e.title, date: e.date, monthKey: e.monthKey })),
    });
  }
  nonMembers.sort(
    (a, b) =>
      b.eventCount - a.eventCount ||
      String(b.lastEventDate || "").localeCompare(String(a.lastEventDate || "")) ||
      a.lastName.localeCompare(b.lastName, "fr") ||
      a.firstName.localeCompare(b.firstName, "fr")
  );

  const withHelloAsso = [...events.values()].filter((e) => e.hasHelloAsso);
  const notRetrieved = withHelloAsso
    .filter((e) => !e.retrieved)
    .sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)))
    .map((e) => ({ id: e.id, title: e.title, date: e.date, monthKey: e.monthKey }));

  return jsonNoStore({
    season,
    counters: {
      participants: people.size,
      members,
      nonMembers: nonMembers.length,
      loyal: nonMembers.filter((p) => p.eventCount >= 2).length,
      rowsWithoutName,
    },
    coverage: {
      pastEventsWithHelloAsso: withHelloAsso.length,
      pastEventsRetrieved: withHelloAsso.length - notRetrieved.length,
      notRetrieved,
    },
    people: nonMembers,
  });
}

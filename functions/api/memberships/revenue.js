import { json } from "../../_lib/http.js";
import { isAuthorized, unauthorized } from "../../_lib/auth.js";
import { isValidExerciseKey, getMembershipRevenue } from "../../_lib/accounting.js";

// GET /api/memberships/revenue?season=2026-2027 — montants de cotisations d'une
// saison, calculés par la SOURCE UNIQUE partagée avec la génération des lignes
// automatiques du compte 7562 (point 3). La page Adhésions et la comptabilité
// s'appuient donc sur exactement les mêmes chiffres.
//
// Renvoie :
//   helloasso   : { total, count } — repris en comptabilité (7562), == somme
//                 des lignes automatiques de l'exercice, au centime près.
//   manual      : { total, count } — montants saisis à la main (hors compta).
//   noAmountCount                  — adhésions sans montant connu.
//   before/after: { total, count } — réglées avant l'ouverture / après la clôture.
//   byMonth     : ventilation par mois.
//   donations   : { count, total } — dons reçus avec les adhésions (hors cotisations).
export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const url = new URL(request.url);
  const season = url.searchParams.get("season");
  if (!isValidExerciseKey(season)) {
    return json({ error: "Paramètre 'season' requis (ex. 2026-2027)." }, { status: 400 });
  }

  const revenue = await getMembershipRevenue(env, season);
  // On ne renvoie pas la liste interne `entries` (détail des lignes 7562) : la
  // page Adhésions n'a besoin que des totaux.
  const { entries, ...publicRevenue } = revenue;
  void entries;
  return json(publicRevenue);
}

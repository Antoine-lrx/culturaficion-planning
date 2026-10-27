// Normalisation d'un nom de personne pour les rapprochements inscrits ↔
// adhérents : minuscules, accents retirés, tirets et apostrophes remplacés
// par une espace, espaces multiples réduits, bords rognés. Sert UNIQUEMENT à
// comparer (égalité stricte, jamais includes/startsWith) : les valeurs
// stockées et affichées ne sont jamais altérées.
export function normalizePersonName(firstName, lastName) {
  return `${firstName || ""} ${lastName || ""}`
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-‐‑‒–—'’‘`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalisation d'une adresse email avant comparaison ou empreinte :
// minuscules, sans aucune espace.
export function normalizeEmail(email) {
  return String(email || "").toLowerCase().replace(/\s+/g, "");
}

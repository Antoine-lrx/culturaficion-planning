// Saison en cours (septembre -> août), calculée côté serveur à partir de la
// date du jour — même convention que la saison de la Frise et des Adhésions.
export function currentSeasonKey(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based ; 8 = septembre
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// Une clé de saison valide est de la forme "AAAA-AAAA" où la seconde année
// vaut la première + 1 (ex. "2026-2027"). Sert à valider le slug du
// formulaire HelloAsso et la variable d'environnement de secours.
export function isValidSeasonKey(key) {
  if (typeof key !== "string") return false;
  const m = /^(\d{4})-(\d{4})$/.exec(key.trim());
  return Boolean(m) && Number(m[2]) === Number(m[1]) + 1;
}

// Déduit la saison du slug d'un formulaire HelloAsso (ex. "temporada-2026-2027"
// -> "2026-2027"). Règle stricte : le slug doit contenir UN SEUL motif
// AAAA-AAAA dont la seconde année vaut la première + 1. Zéro motif valide, ou
// plusieurs motifs distincts (slug ambigu), renvoient null : on ne devine pas.
export function seasonFromSlug(slug) {
  const found = new Set();
  const re = /(\d{4})-(\d{4})/g;
  let m;
  while ((m = re.exec(String(slug || ""))) !== null) {
    const y1 = Number(m[1]);
    const y2 = Number(m[2]);
    if (y2 === y1 + 1) found.add(`${y1}-${y2}`);
  }
  return found.size === 1 ? [...found][0] : null;
}

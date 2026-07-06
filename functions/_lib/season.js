// Saison en cours (septembre -> août), calculée côté serveur à partir de la
// date du jour — même convention que la saison de la Frise et des Adhésions.
export function currentSeasonKey(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based ; 8 = septembre
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

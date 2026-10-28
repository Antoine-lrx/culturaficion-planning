import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Loader2, AlertTriangle } from "lucide-react";
import { api } from "./api.js";

/* ─────────────────────────────────────────────────────────────
   Culturafición · Venus sans adhérer (page Adhésions)
   Personnes venues aux événements passés de la saison EN COURS
   sans y être adhérentes. Outil de pilotage en lecture seule :
   ni email, ni copie, ni export, ni relance (la relance reste
   dans la fiche de chaque événement). Repliée par défaut : rien
   n'est chargé tant qu'elle n'est pas ouverte (quotas D1).
   ───────────────────────────────────────────────────────────── */

const FILTERS = [
  { id: "all", label: "Tous" },
  { id: "loyal", label: "Fidèles (2+)" },
];

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// "2026-10-14" → « 14 oct. » ; "2026-10" (événement sans date) → « oct. 2026 ».
function fmtEventDate(value) {
  if (!value) return "";
  try {
    if (value.length === 7) {
      return new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" }).format(new Date(value + "-01T00:00:00"));
    }
    return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(value + "T00:00:00"));
  } catch { return value; }
}
const eventWhen = (ev) => fmtEventDate(ev.date || ev.monthKey);

export default function NonMemberAttendees({ fallbackSeason, refreshKey, detailOpen, onOpenEvent, onUnauthorized }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: "idle", data: null, error: "" });
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(() => new Set());

  const load = async () => {
    setState((s) => ({ status: "loading", data: s.data, error: "" }));
    try {
      setState({ status: "ok", data: await api.getAttendeesWithoutMembership(), error: "" });
    } catch (e) {
      if (e && e.unauthorized) { onUnauthorized(); return; }
      setState((s) => ({ status: "error", data: s.data, error: e.message || "Erreur" }));
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state.status === "idle") load();
  };

  // Rechargement seulement si la section a déjà été ouverte : bouton
  // « Rafraîchir », ou retour d'une fiche (inscrits récupérés, absent…).
  const prevDetailOpen = useRef(detailOpen);
  useEffect(() => {
    const closed = prevDetailOpen.current && !detailOpen;
    prevDetailOpen.current = detailOpen;
    if (closed && open && state.status !== "idle") load();
  }, [detailOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (refreshKey && open && state.status !== "idle") load();
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpanded = (key) =>
    setExpanded((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const data = state.data;
  const season = (data && data.season) || fallbackSeason;
  const c = data ? data.counters : null;
  const cov = data ? data.coverage : null;
  const people = data ? data.people.filter((p) => filter === "all" || p.eventCount >= 2) : [];
  const rate = c && c.participants > 0 ? Math.round((c.members / c.participants) * 100) : null;

  return (
    <>
      <div className="cf-rule" />
      <button className="cf-nr-toggle" onClick={toggle} aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", font: "inherit", color: "inherit", padding: 0, textAlign: "left" }}>
        {open ? <ChevronDown size={18} style={{ flex: "none" }} /> : <ChevronRight size={18} style={{ flex: "none" }} />}
        <span className="cf-display" style={{ fontSize: 22 }}>Venus sans adhérer{season ? ` — saison ${season}` : ""}</span>
      </button>
      <span className="cf-search-count">Saison en cours, calculée sur la date du jour</span>

      {open && (
        <div className="cf-att" style={{ borderTop: 0, paddingTop: 4 }}>
          {state.status === "loading" && (
            <div className="cf-att-meta"><Loader2 size={14} className="spin" /> Chargement…</div>
          )}
          {state.error && <div className="cf-note warn"><AlertTriangle size={14} /> <span>{state.error}</span></div>}

          {data && (
            <>
              <div className="cf-stat net">
                <span>Non-adhérents venus cette saison</span>
                <span className="val">{c.nonMembers}</span>
              </div>
              <div className="cf-att-stats">
                <div className="cf-stat"><span>Participants</span><span className="val">{c.participants}</span></div>
                <div className="cf-stat"><span>dont adhérents</span><span className="val">{c.members}</span></div>
                <div className="cf-stat"><span>Fidèles (2+)</span><span className="val">{c.loyal}</span></div>
                <div className="cf-stat"><span>Taux d'adhésion</span><span className="val">{rate == null ? "—" : `${rate} %`}</span></div>
              </div>

              <div className="cf-att-meta">
                {cov.pastEventsWithHelloAsso === 0
                  ? "Aucun événement passé avec billetterie cette saison."
                  : `Basé sur ${cov.pastEventsRetrieved} événement${cov.pastEventsRetrieved > 1 ? "s" : ""} passé${cov.pastEventsRetrieved > 1 ? "s" : ""} sur ${cov.pastEventsWithHelloAsso} avec billetterie.`}
                {c.rowsWithoutName > 0 && ` ${plural(c.rowsWithoutName, "billet sans nom n'est pas compté", "billets sans nom ne sont pas comptés")}.`}
              </div>
              {cov.notRetrieved.length > 0 && (
                <div className="cf-att-meta">
                  <span>Inscrits non récupérés :</span>
                  {cov.notRetrieved.map((ev) => (
                    <button key={ev.id} className="cf-att-link" title="Ouvrir la fiche pour récupérer les inscrits"
                      onClick={() => onOpenEvent(ev.id)}>
                      {ev.title}{eventWhen(ev) ? ` (${eventWhen(ev)})` : ""}
                    </button>
                  ))}
                </div>
              )}

              {data.people.length > 0 && (
                <div className="cf-att-actions">
                  {FILTERS.map((f) => (
                    <button key={f.id} className="cf-sf" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
                  ))}
                </div>
              )}

              {people.length === 0 ? (
                <div className="cf-nr-empty">
                  {data.people.length === 0 ? "Personne pour l'instant." : "Personne n'est venu à 2 événements ou plus."}
                </div>
              ) : (
                <div className="cf-memb-list">
                  {people.map((p, i) => {
                    const key = `${p.firstName}|${p.lastName}|${i}`;
                    const isOpen = expanded.has(key);
                    const name = `${p.firstName} ${p.lastName}`.trim();
                    return (
                      <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div className="cf-memb-row cf-nm-row" role="button" tabIndex={0} aria-expanded={isOpen}
                          style={{ cursor: "pointer" }}
                          onClick={() => toggleExpanded(key)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpanded(key); } }}>
                          <span className="cf-memb-name" title={name}>
                            {isOpen ? <ChevronDown size={14} style={{ verticalAlign: -2, marginRight: 4 }} /> : <ChevronRight size={14} style={{ verticalAlign: -2, marginRight: 4 }} />}
                            {name}
                          </span>
                          <span className="cf-pill" style={{ color: p.eventCount >= 2 ? "var(--oro)" : "#9a8d7c", flex: "none" }}>
                            {plural(p.eventCount, "événement", "événements")}
                          </span>
                          <span className="cf-memb-date">Dernier : {fmtEventDate(p.lastEventDate)}</span>
                        </div>
                        {isOpen && (
                          <div className="cf-suggestions" style={{ paddingLeft: 14 }}>
                            {p.events.map((ev) => (
                              <button key={ev.id} className="cf-suggestion" onClick={() => onOpenEvent(ev.id)}>
                                <span className="cf-suggestion-title">{ev.title}</span>
                                <span className="cf-suggestion-meta">{eventWhen(ev)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

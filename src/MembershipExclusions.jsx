import React, { useState, useCallback } from "react";
import { ChevronDown, ChevronRight, X, Check, Loader2, Undo2, EyeOff } from "lucide-react";
import { api } from "./api.js";

/* ─────────────────────────────────────────────────────────────
   Culturafición · Retraits manuels (page Adhésions)
   Partagé par « Perdus de vue » et « Venus sans adhérer » :
   bouton « Retirer de la liste », modale de confirmation avec un
   motif fermé (pas de texte libre, RGPD) et bloc repliable
   « Retirés manuellement (n) » avec « Réintégrer ».
   ───────────────────────────────────────────────────────────── */

export const EXCLUSION_REASONS = [
  {
    id: "readhere_autrement",
    label: "A réadhéré (autre nom / autre email)",
    scope: "Retirée pour la saison en cours uniquement.",
  },
  {
    id: "ne_plus_afficher",
    label: "Ne plus afficher",
    scope: "Retrait définitif, valable pour les saisons suivantes aussi.",
  },
  {
    id: "autre",
    label: "Autre",
    scope: "Retirée pour la saison en cours uniquement.",
  },
];
const REASON_LABEL = Object.fromEntries(EXCLUSION_REASONS.map((r) => [r.id, r.label]));

// Actions de retrait / réintégration pour une liste donnée. `reload` est
// rappelé après chaque action réussie pour que liste et compteurs se mettent
// à jour (une seule requête de liste, jamais un appel par ligne).
export function useExclusions(list, reload, onUnauthorized) {
  const [target, setTarget] = useState(null); // { personKey, name }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const handleError = (e) => {
    if (e && e.unauthorized) { onUnauthorized && onUnauthorized(); return true; }
    return false;
  };

  const askExclude = useCallback((personKey, name) => {
    setError("");
    setTarget({ personKey, name });
  }, []);

  const confirmExclude = async (reason) => {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      await api.createMembershipExclusion(list, target.personKey, reason);
      setTarget(null);
      await reload();
    } catch (e) {
      if (!handleError(e)) setError(e.message || "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const reinstate = async (exclusionId) => {
    setBusyId(exclusionId);
    try {
      await api.deleteMembershipExclusion(exclusionId);
      await reload();
    } catch (e) {
      if (!handleError(e)) alert("Erreur : " + (e.message || "réintégration impossible"));
    } finally {
      setBusyId(null);
    }
  };

  return { target, busy, error, busyId, askExclude, cancel: () => setTarget(null), confirmExclude, reinstate };
}

// Petit bouton discret placé en bout de ligne.
export function ExcludeButton({ onClick, name }) {
  return (
    <button type="button" className="cf-excl-btn" title={`Retirer ${name} de la liste`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => e.stopPropagation()}>
      <EyeOff size={12} /> Retirer de la liste
    </button>
  );
}

// Modale de confirmation : un motif à choisir parmi trois, aucun texte libre.
export function ExclusionModal({ name, listLabel, busy, error, onCancel, onConfirm }) {
  const [reason, setReason] = useState("readhere_autrement");
  const current = EXCLUSION_REASONS.find((r) => r.id === reason);
  return (
    <div className="cf-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="cf-modal" role="dialog" aria-modal="true" aria-label="Retirer de la liste">
        <div className="cf-modal-head">
          <h3>Retirer de la liste</h3>
          <button className="cf-iconbtn" aria-label="Fermer" onClick={onCancel} disabled={busy}><X size={16} /></button>
        </div>
        <div className="cf-modal-body">
          <span style={{ fontSize: 14 }}>
            Retirer <b>{name}</b> de « {listLabel} » ?
          </span>
          <div className="cf-field">
            <span>Motif</span>
            <div className="cf-pickrow">
              {EXCLUSION_REASONS.map((r) => (
                <button key={r.id} type="button" className="cf-pick" aria-pressed={reason === r.id}
                  onClick={() => setReason(r.id)}>{r.label}</button>
              ))}
            </div>
            <p className="cf-subhint" style={{ margin: 0 }}>{current.scope} Réintégrable à tout moment.</p>
          </div>
          {error && <span className="cf-hint">{error}</span>}
        </div>
        <div className="cf-modal-foot">
          <button className="cf-btn cf-btn-ghost" onClick={onCancel} disabled={busy}>Annuler</button>
          <button className="cf-btn cf-btn-primary" onClick={() => onConfirm(reason)} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Retirer
          </button>
        </div>
      </div>
    </div>
  );
}

// Bloc repliable en bas de liste. `items` : personnes retirées, chacune avec
// `exclusion` ({ id, reason, permanent }) ; `nameOf` et `metaOf` adaptent
// l'affichage à la liste concernée.
export function ExcludedBlock({ items, nameOf, metaOf, busyId, onReinstate }) {
  const [open, setOpen] = useState(false);
  if (!items || items.length === 0) return null;
  return (
    <div className="cf-excl-block">
      <button type="button" className="cf-nr-toggle cf-excl-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        Retirés manuellement ({items.length})
      </button>
      {open && (
        <div className="cf-memb-list">
          {items.map((p) => {
            const ex = p.exclusion;
            const name = nameOf(p);
            return (
              <div className="cf-memb-row cf-excl-row" key={ex.id}>
                <span className="cf-memb-name" title={name}>{name}</span>
                <span className="cf-memb-date">
                  {REASON_LABEL[ex.reason] || "—"} · {ex.permanent ? "définitif" : "cette saison"}
                  {metaOf ? ` · ${metaOf(p)}` : ""}
                </span>
                <button type="button" className="cf-btn cf-btn-ghost cf-btn-sm" disabled={busyId === ex.id}
                  onClick={() => onReinstate(ex.id)}>
                  {busyId === ex.id ? <Loader2 size={12} className="spin" /> : <Undo2 size={12} />} Réintégrer
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

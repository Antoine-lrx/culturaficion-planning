import React, { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Trash2, Copy, AlertTriangle, Check } from "lucide-react";
import { api } from "./api.js";

/* ─────────────────────────────────────────────────────────────
   Culturafición · Inscrits d'un événement (fiche bilan)
   Liste des billets HelloAsso, étiquette adhérent / non adhérent
   et suivi de relance. Section repliée par défaut : rien n'est
   chargé tant qu'elle n'est pas ouverte. Réutilise les classes
   cf-* de l'app (feuille de style injectée par App.jsx).
   ───────────────────────────────────────────────────────────── */

const FILTERS = [
  { id: "all", label: "Tous" },
  { id: "non", label: "Non-adhérents" },
  { id: "members", label: "Adhérents" },
];

const STATUS_LABELS = {
  a_relancer: "À relancer",
  relance: "Relancé",
  ne_plus_contacter: "Ne plus contacter",
};

function fmtDateTime(value) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      .format(new Date(value));
  } catch { return null; }
}

function fmtShortDate(ms) {
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(ms));
  } catch { return ""; }
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

export default function Attendees({ eventId, hasSlug, onUnauthorized }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: "idle", data: null, error: "" });
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("non");
  // Copie des emails : { status: idle|loading|copied|manual|empty|error, emails, warning, error }
  const [copy, setCopy] = useState({ status: "idle" });
  const [busyId, setBusyId] = useState(null);

  const fail = (e, keepData = true) => {
    if (e && e.unauthorized) { onUnauthorized(); return; }
    setState((s) => ({ status: keepData && s.data ? "ok" : "error", data: keepData ? s.data : null, error: e.message || "Erreur" }));
  };

  const apply = (data) => setState({ status: "ok", data, error: "" });

  const load = async () => {
    setState({ status: "loading", data: null, error: "" });
    try {
      apply(await api.listAttendees(eventId));
    } catch (e) {
      fail(e, false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state.status === "idle") load();
  };

  const sync = async () => {
    setSyncing(true);
    setNotice("");
    setCopy({ status: "idle" });
    try {
      const data = await api.syncAttendees(eventId);
      apply(data);
      if (data.warning) setNotice(data.warning);
    } catch (e) {
      // La liste déjà affichée est conservée (rien n'est effacé côté serveur).
      fail(e);
    } finally {
      setSyncing(false);
    }
  };

  const update = async (id, patch) => {
    setBusyId(id);
    try {
      apply(await api.updateAttendee(id, patch));
    } catch (e) {
      fail(e);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id) => {
    setBusyId(id);
    try {
      apply(await api.deleteAttendee(id));
    } catch (e) {
      fail(e);
    } finally {
      setBusyId(null);
    }
  };

  const removeAll = async () => {
    if (!window.confirm("Supprimer la liste des inscrits de cet événement ?\n\nLes statuts de relance seront perdus. La liste d'opposition (« ne plus contacter ») est conservée.")) return;
    setCopy({ status: "idle" });
    try {
      apply(await api.deleteAttendeeList(eventId));
    } catch (e) {
      fail(e);
    }
  };

  // Copie dans le presse-papiers. Le ClipboardItem reçoit une promesse dès le
  // clic : la copie reste autorisée par le navigateur même si la réponse du
  // serveur arrive après (Safari notamment). À défaut, les adresses sont
  // affichées pour une copie à la main.
  const copyEmails = async () => {
    setCopy({ status: "loading" });
    let res = null;
    const textP = api.getAttendeeEmails(eventId).then((r) => {
      res = r;
      if (!r.emails.length) throw new Error("EMPTY");
      return r.emails.join(", ");
    });
    let copied = false;
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new window.ClipboardItem({ "text/plain": textP.then((t) => new Blob([t], { type: "text/plain" })) }),
        ]);
        copied = true;
      }
    } catch { /* second essai ci-dessous */ }
    if (!copied) {
      try {
        await navigator.clipboard.writeText(await textP);
        copied = true;
      } catch { /* traité ci-dessous */ }
    }
    try {
      await textP;
    } catch (e) {
      if (e.unauthorized) { onUnauthorized(); return; }
      if (e.message === "EMPTY") { setCopy({ status: "empty", warning: res && res.warning }); return; }
      setCopy({ status: "error", error: e.message || "Erreur" });
      return;
    }
    setCopy({ status: copied ? "copied" : "manual", emails: res.emails, warning: res.warning });
  };

  const markFollowedUp = async () => {
    const emails = copy.emails || [];
    setCopy({ status: "marking", emails });
    try {
      const data = await api.markAttendeesFollowedUp(eventId, emails);
      apply(data);
      setCopy({ status: "marked", count: data.marked });
    } catch (e) {
      setCopy({ status: "idle" });
      fail(e);
    }
  };

  const data = state.data;
  const list = data ? data.attendees : [];
  const shown = list.filter((a) => (filter === "all" ? true : filter === "members" ? a.isMember : !a.isMember));
  const lastSync = data && fmtDateTime(data.lastSync);

  return (
    <div className="cf-att">
      <button className="cf-att-toggle" aria-expanded={open} onClick={toggle}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Inscrits</span>
        {data && data.counts.registered > 0 && <span className="cf-att-badge">{data.counts.registered}</span>}
      </button>

      {open && (
        <>
          {state.status === "loading" && (
            <div className="cf-att-meta"><Loader2 size={14} className="spin" /> Chargement…</div>
          )}
          {state.error && <div className="cf-note warn"><AlertTriangle size={14} /> <span>{state.error}</span></div>}

          {data && (
            <>
              {data.counts.registered > 0 && (
                <div className="cf-att-stats">
                  <div className="cf-stat"><span>Inscrits</span><span className="val">{data.counts.registered}</span></div>
                  <div className="cf-stat"><span>Adhérents</span><span className="val">{data.counts.members}</span></div>
                  <div className="cf-stat"><span>Non-adhérents</span><span className="val">{data.counts.nonMembers}</span></div>
                  <div className="cf-stat"><span>À relancer</span><span className="val">{data.counts.toFollowUp}</span></div>
                </div>
              )}
              {lastSync && (
                <div className="cf-att-meta">
                  Dernière récupération : {lastSync}
                  {data.donations > 0 && ` · ${plural(data.counts.registered, "billet", "billets")}, ${plural(data.donations, "don non compté", "dons non comptés")}`}
                </div>
              )}

              {hasSlug ? (
                <div className="cf-att-actions">
                  <button className="cf-btn cf-btn-primary cf-btn-sm" onClick={sync} disabled={syncing}>
                    {syncing
                      ? <><Loader2 size={14} className="spin" /> Récupération…</>
                      : <><RefreshCw size={14} /> {data.counts.registered > 0 || lastSync ? "Mettre à jour" : "Récupérer les inscrits"}</>}
                  </button>
                  {data.counts.registered > 0 && (
                    <button className="cf-btn cf-btn-ghost cf-btn-sm" onClick={copyEmails}
                      disabled={copy.status === "loading" || copy.status === "marking"}>
                      {copy.status === "loading" ? <Loader2 size={14} className="spin" /> : <Copy size={14} />} Copier les emails à relancer
                    </button>
                  )}
                </div>
              ) : (
                <div className="cf-note">Ajoute l'identifiant HelloAsso de l'événement pour récupérer les inscrits.</div>
              )}
              {notice && <div className="cf-att-meta">{notice}</div>}

              {copy.status === "empty" && <div className="cf-note">Aucune adresse à relancer pour le moment.</div>}
              {copy.status === "error" && <div className="cf-note warn"><AlertTriangle size={14} /> <span>{copy.error}</span></div>}
              {(copy.status === "copied" || copy.status === "manual") && (
                <div className="cf-note cf-att-copy">
                  {copy.status === "copied" ? (
                    <b>{plural(copy.emails.length, "adresse copiée", "adresses copiées")} — colle-{copy.emails.length > 1 ? "les" : "la"} en Cci</b>
                  ) : (
                    <>
                      <b>Copie automatique impossible : sélectionne ces {plural(copy.emails.length, "adresse", "adresses")} et colle-les en Cci.</b>
                      <textarea className="cf-area" readOnly rows={3} value={copy.emails.join(", ")} onFocus={(e) => e.target.select()} />
                    </>
                  )}
                  {copy.warning && <span className="cf-att-meta">{copy.warning}</span>}
                  <span>Marquer {copy.emails.length > 1 ? `ces ${copy.emails.length} personnes` : "cette personne"} comme relancée{copy.emails.length > 1 ? "s" : ""} ?</span>
                  <div className="cf-att-actions">
                    <button className="cf-btn cf-btn-primary cf-btn-sm" onClick={markFollowedUp}><Check size={14} /> Oui</button>
                    <button className="cf-btn cf-btn-ghost cf-btn-sm" onClick={() => setCopy({ status: "idle" })}>Plus tard</button>
                  </div>
                </div>
              )}
              {copy.status === "marking" && <div className="cf-att-meta"><Loader2 size={14} className="spin" /> Enregistrement…</div>}
              {copy.status === "marked" && (
                <div className="cf-att-meta">{plural(copy.count, "ligne passée", "lignes passées")} en « relancé ».</div>
              )}

              {list.length > 0 && (
                <>
                  <div className="cf-att-actions">
                    {FILTERS.map((f) => (
                      <button key={f.id} className="cf-sf" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
                    ))}
                  </div>

                  <div className="cf-att-list">
                    {shown.length === 0 && <div className="cf-att-meta">Personne dans ce filtre.</div>}
                    {shown.map((a) => (
                      <AttendeeRow key={a.id} a={a} busy={busyId === a.id} onUpdate={update} onRemove={remove} />
                    ))}
                  </div>

                  <button className="cf-att-link" onClick={removeAll}>Supprimer la liste des inscrits</button>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function AttendeeRow({ a, busy, onUpdate, onRemove }) {
  const name = `${a.firstName} ${a.lastName}`.trim() || "Sans nom";
  let emailEl;
  if (!a.email) emailEl = <span className="cf-att-email via">Pas d'email</span>;
  else if (a.emailSource === "payeur_tiers") emailEl = <span className="cf-att-email via" title={a.email}>via {a.payerName || "le payeur"}</span>;
  else emailEl = <span className="cf-att-email">{a.email}</span>;

  const matchLabel = a.memberMatch === "email" ? "Reconnu par email" : a.memberMatch === "nom" ? "Reconnu par nom" : "";

  return (
    <div className={"cf-att-row" + (!a.isMember && a.absent ? " absent" : "")} aria-busy={busy}>
      <div className="cf-att-top">
        <span className="cf-att-name">{name}</span>
        {a.isMember
          ? <span className="cf-pill cf-att-member" title={matchLabel} aria-label={`Adhérent — ${matchLabel}`}>Adhérent</span>
          : <span className="cf-pill cf-att-nonmember">Non adhérent</span>}
        <button className="cf-act" aria-label={`Supprimer ${name}`} title="Supprimer cette ligne" disabled={busy}
          onClick={() => onRemove(a.id)}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="cf-att-bottom">
        {emailEl}
        {!a.isMember && (
          <>
            <select className="cf-att-status" value={a.followUpStatus || "a_relancer"} disabled={busy}
              aria-label={`Statut de relance de ${name}`}
              onChange={(e) => onUpdate(a.id, { followUpStatus: e.target.value })}>
              {Object.entries(STATUS_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {k === "relance" && a.followUpStatus === "relance" && a.followedUpAt ? `${label} le ${fmtShortDate(a.followedUpAt)}` : label}
                </option>
              ))}
            </select>
            <label className="cf-att-absent">
              <input type="checkbox" checked={a.absent} disabled={busy}
                onChange={(e) => onUpdate(a.id, { absent: e.target.checked })} />
              absent
            </label>
          </>
        )}
      </div>
    </div>
  );
}

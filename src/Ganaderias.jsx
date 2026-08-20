import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Plus, X, Check, Pencil, Trash2, Phone, Instagram, CalendarDays, Loader2, MapPin,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "./api.js";

/* ─────────────────────────────────────────────────────────────
   Culturafición · Ganaderías
   Annuaire de prospection de la branche Prácticos : élevages
   français et espagnols, statut de contact, carte interactive.
   Réutilise les classes cf-* de l'app (même feuille de style,
   injectée une seule fois par App.jsx).
   ───────────────────────────────────────────────────────────── */

const GANAD_COUNTRIES = [
  { id: "france", label: "France", center: [46.6, 2.5], zoom: 6 },
  { id: "espagne", label: "España", center: [40.0, -3.7], zoom: 6 },
];

const GANAD_STATUSES = {
  a_contacter: { label: "À contacter", color: "#BB322C" },
  en_attente: { label: "En attente", color: "#B8862E" },
  partenaire: { label: "Partenaire", color: "#4A7A3F" },
};
const GANAD_STATUS_KEYS = Object.keys(GANAD_STATUSES);

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

function fmtDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso + "T00:00:00");
    return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(d);
  } catch { return null; }
}

function emptyDraft(country) {
  return {
    id: uid(), name: "", country, status: "a_contacter", address: "",
    latitude: "", longitude: "", contactName: "", contactPhone: "",
    contactInstagram: "", lastContactDate: "", comments: "",
  };
}

export default function Ganaderias({ onUnauthorized, refreshKey }) {
  const [country, setCountry] = useState("france");
  const [ganaderias, setGanaderias] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState(() => new Set(GANAD_STATUS_KEYS));
  const [modal, setModal] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [saving, setSaving] = useState(false);

  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  const loadList = useCallback(async (c) => {
    setError("");
    setLoading(true);
    try {
      const list = await api.listGanaderias(c);
      setGanaderias(list || []);
    } catch (e) {
      if (e.unauthorized) {
        onUnauthorized && onUnauthorized();
      } else {
        setError("Impossible de charger les ganaderías. Vérifiez votre connexion et réessayez.");
      }
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => { loadList(country); }, [country, loadList, refreshKey]);

  // Carte Leaflet : un seul objet L.Map, recentré selon l'onglet pays.
  useEffect(() => {
    if (!mapElRef.current) return;
    const def = GANAD_COUNTRIES.find((c) => c.id === country);
    if (!mapRef.current) {
      mapRef.current = L.map(mapElRef.current, { scrollWheelZoom: false }).setView(def.center, def.zoom);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(mapRef.current);
    } else {
      mapRef.current.setView(def.center, def.zoom);
    }
  }, [country]);

  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
  }, []);

  // Marqueurs : un cercle coloré par statut, recalculés à chaque chargement.
  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    ganaderias.forEach((g) => {
      if (g.latitude == null || g.longitude == null) return;
      const color = (GANAD_STATUSES[g.status] || {}).color || "#6B6258";
      const marker = L.circleMarker([g.latitude, g.longitude], {
        radius: 9, color: "#1A1413", weight: 1.5, fillColor: color, fillOpacity: 0.9,
      }).addTo(mapRef.current);
      marker.bindTooltip(g.name, { direction: "top", offset: [0, -8] });
      marker.on("click", () => setDetailId(g.id));
      markersRef.current.push(marker);
    });
  }, [ganaderias]);

  const filtered = useMemo(
    () => ganaderias.filter((g) => statusFilter.has(g.status)),
    [ganaderias, statusFilter]
  );

  const toggleStatus = (key) =>
    setStatusFilter((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const openAdd = () => setModal({ mode: "add", draft: emptyDraft(country), geoFailed: false });
  const openEdit = (g) => setModal({
    mode: "edit",
    draft: {
      ...g,
      latitude: g.latitude != null ? String(g.latitude) : "",
      longitude: g.longitude != null ? String(g.longitude) : "",
      address: g.address || "", contactName: g.contactName || "", contactPhone: g.contactPhone || "",
      contactInstagram: g.contactInstagram || "", lastContactDate: g.lastContactDate || "", comments: g.comments || "",
    },
    geoFailed: Boolean(g.address) && g.latitude == null,
  });

  const submitModal = async () => {
    const d = modal.draft;
    if (!d.name.trim() || !d.country || !d.status) return;
    const manualLat = d.latitude !== "" ? Number(d.latitude) : null;
    const manualLng = d.longitude !== "" ? Number(d.longitude) : null;
    if ((d.latitude !== "" && !Number.isFinite(manualLat)) || (d.longitude !== "" && !Number.isFinite(manualLng))) return;

    const payload = {
      name: d.name.trim(), country: d.country, status: d.status,
      address: d.address.trim() || null,
      contactName: d.contactName.trim() || null,
      contactPhone: d.contactPhone.trim() || null,
      contactInstagram: d.contactInstagram.trim().replace(/^@+/, "") || null,
      lastContactDate: d.lastContactDate || null,
      comments: d.comments.trim() || null,
    };
    if (manualLat != null && manualLng != null) {
      payload.latitude = manualLat;
      payload.longitude = manualLng;
    }

    setSaving(true);
    try {
      const saved = modal.mode === "add"
        ? await api.createGanaderia({ id: d.id, ...payload })
        : await api.updateGanaderia(d.id, payload);

      if (saved.geocodingFailed) {
        setModal((m) => ({ ...m, geoFailed: true, draft: { ...m.draft, latitude: "", longitude: "" } }));
        return;
      }
      setModal(null);
      loadList(country);
    } catch (e) {
      alert("Erreur : " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const removeGanaderia = async (id) => {
    if (!window.confirm("Supprimer définitivement cette ganadería ? Cette action est irréversible.")) return;
    try {
      await api.deleteGanaderia(id);
      setGanaderias((list) => list.filter((g) => g.id !== id));
      if (detailId === id) setDetailId(null);
    } catch (e) {
      alert("Erreur : " + e.message);
    }
  };

  const detailGanaderia = ganaderias.find((g) => g.id === detailId) || null;
  const showManualCoords = Boolean(modal) && (!modal.draft.address.trim() || modal.geoFailed);

  return (
    <div className="cf-home">
      <div className="cf-controls">
        <h2 className="cf-display" style={{ fontSize: 32, margin: 0 }}>Ganaderías</h2>
        <div className="cf-spacer" />
        <div className="cf-viewtoggle">
          {GANAD_COUNTRIES.map((c) => (
            <button key={c.id} className="cf-vt" aria-pressed={country === c.id} onClick={() => setCountry(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <button className="cf-btn cf-btn-primary" onClick={openAdd}>
          <Plus size={17} /> Ajouter une ganadería
        </button>
      </div>

      {error && <div className="cf-note error">{error}</div>}

      <div ref={mapElRef} className="cf-ganad-map" style={{ position: "relative", zIndex: 0 }} />

      <div className="cf-legend">
        {GANAD_STATUS_KEYS.map((k) => (
          <span key={k} className="cf-chip" style={{ cursor: "default", opacity: 1 }}>
            <span className="dot" style={{ background: GANAD_STATUSES[k].color }} />
            {GANAD_STATUSES[k].label}
          </span>
        ))}
      </div>

      <div className="cf-controls" style={{ margin: "0 0 4px" }}>
        <div className="cf-statusfilter" style={{ marginLeft: 0 }}>
          {GANAD_STATUS_KEYS.map((k) => (
            <button key={k} className="cf-sf" aria-pressed={statusFilter.has(k)} onClick={() => toggleStatus(k)}>
              {GANAD_STATUSES[k].label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="cf-loading" style={{ minHeight: "auto", padding: "26px 0" }}>
          <Loader2 size={22} className="spin" /> <span>Chargement…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="cf-empty" style={{ flex: "none" }}>
          <b>Aucune ganadería{ganaderias.length > 0 ? " pour ce filtre" : ""}</b>
          <span>
            {ganaderias.length > 0
              ? "Changez le filtre de statut ci-dessus pour voir les autres ganaderías."
              : `Ajoutez la première ganadería ${country === "france" ? "française" : "espagnole"} de l'annuaire.`}
          </span>
          {ganaderias.length === 0 && (
            <button className="cf-btn cf-btn-primary" style={{ alignSelf: "flex-start" }} onClick={openAdd}>
              <Plus size={16} /> Première ganadería
            </button>
          )}
        </div>
      ) : (
        <>
          <span className="cf-search-count">
            {filtered.length} ganadería{filtered.length > 1 ? "s" : ""}
          </span>
          <div className="cf-search-list">
            {filtered.map((g) => {
              const st = GANAD_STATUSES[g.status] || GANAD_STATUSES.a_contacter;
              const when = fmtDate(g.lastContactDate);
              return (
                <div className="cf-search-card" key={g.id} tabIndex={0} role="button"
                  aria-label={"Ouvrir la fiche : " + g.name}
                  onClick={() => setDetailId(g.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailId(g.id); } }}>
                  <span className="stripe" style={{ background: st.color }} />
                  <div className="cf-search-card-main">
                    <div className="cf-card-title">{g.name}</div>
                    <div className="cf-card-meta">
                      <span className="cf-pill" style={{ color: st.color }}>{st.label}</span>
                      {g.contactName && <span>{g.contactName}</span>}
                      {when && <span className="when"><CalendarDays size={12} /> Dernier contact : {when}</span>}
                    </div>
                  </div>
                  <div className="cf-card-actions">
                    <button className="cf-act" aria-label="Modifier" onClick={(e) => { e.stopPropagation(); openEdit(g); }}>
                      <Pencil size={13} />
                    </button>
                    <button className="cf-act" aria-label="Supprimer" onClick={(e) => { e.stopPropagation(); removeGanaderia(g.id); }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* fiche détaillée */}
      {detailGanaderia && (
        <div className="cf-scrim" onMouseDown={(e) => e.target === e.currentTarget && setDetailId(null)}>
          <div className="cf-modal" role="dialog" aria-modal="true">
            <div className="cf-modal-head">
              <h3>{detailGanaderia.name}</h3>
              <button className="cf-iconbtn" aria-label="Fermer" onClick={() => setDetailId(null)}><X size={16} /></button>
            </div>
            <div className="cf-modal-body">
              <div className="cf-detail-meta">
                <span>{detailGanaderia.country === "france" ? "France" : "España"}</span>
                <span className="cf-pill" style={{ color: (GANAD_STATUSES[detailGanaderia.status] || {}).color }}>
                  {(GANAD_STATUSES[detailGanaderia.status] || {}).label}
                </span>
              </div>
              {detailGanaderia.address && (
                <div className="cf-field">
                  <span>Adresse</span>
                  <span><MapPin size={13} style={{ verticalAlign: -2 }} /> {detailGanaderia.address}</span>
                </div>
              )}
              {detailGanaderia.contactName && (
                <div className="cf-field">
                  <span>Contact</span>
                  <span>{detailGanaderia.contactName}</span>
                </div>
              )}
              {detailGanaderia.contactPhone && (
                <div className="cf-field">
                  <span>Téléphone</span>
                  <a className="cf-link" href={`tel:${detailGanaderia.contactPhone}`}>
                    <Phone size={13} style={{ verticalAlign: -2 }} /> {detailGanaderia.contactPhone}
                  </a>
                </div>
              )}
              {detailGanaderia.contactInstagram && (
                <div className="cf-field">
                  <span>Instagram</span>
                  <a className="cf-link" href={`https://instagram.com/${detailGanaderia.contactInstagram}`} target="_blank" rel="noreferrer">
                    <Instagram size={13} style={{ verticalAlign: -2 }} /> @{detailGanaderia.contactInstagram}
                  </a>
                </div>
              )}
              {detailGanaderia.lastContactDate && (
                <div className="cf-field">
                  <span>Dernier contact</span>
                  <span>{fmtDate(detailGanaderia.lastContactDate)}</span>
                </div>
              )}
              {detailGanaderia.comments && (
                <div className="cf-field">
                  <span>Commentaires</span>
                  <textarea className="cf-area" value={detailGanaderia.comments} readOnly rows={4} />
                </div>
              )}
            </div>
            <div className="cf-modal-foot">
              <button className="cf-btn cf-btn-ghost" onClick={() => setDetailId(null)}>Fermer</button>
              <button className="cf-btn cf-btn-primary" onClick={() => { openEdit(detailGanaderia); setDetailId(null); }}>
                <Pencil size={15} /> Modifier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* formulaire d'ajout / modification */}
      {modal && (
        <div className="cf-scrim" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="cf-modal" role="dialog" aria-modal="true">
            <div className="cf-modal-head">
              <h3>{modal.mode === "add" ? "Nouvelle ganadería" : "Modifier la ganadería"}</h3>
              <button className="cf-iconbtn" aria-label="Fermer" onClick={() => setModal(null)}><X size={16} /></button>
            </div>
            <div className="cf-modal-body">
              <label className="cf-field">
                <span>Nom de la ganadería</span>
                <input className="cf-input" autoFocus value={modal.draft.name}
                  onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, name: e.target.value } }))} />
              </label>

              <div className="cf-field">
                <span>Pays</span>
                <div className="cf-pickrow">
                  {GANAD_COUNTRIES.map((c) => (
                    <button key={c.id} className="cf-pick" aria-pressed={modal.draft.country === c.id}
                      onClick={() => setModal((m) => ({ ...m, draft: { ...m.draft, country: c.id } }))}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="cf-field">
                <span>Statut</span>
                <div className="cf-pickrow">
                  {GANAD_STATUS_KEYS.map((k) => (
                    <button key={k} className="cf-pick" aria-pressed={modal.draft.status === k}
                      onClick={() => setModal((m) => ({ ...m, draft: { ...m.draft, status: k } }))}>
                      <span className="dot" style={{ background: GANAD_STATUSES[k].color }} />
                      {GANAD_STATUSES[k].label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="cf-field">
                <span>Adresse (facultatif)</span>
                <input className="cf-input" value={modal.draft.address}
                  placeholder="ex. Finca El Retamar, 41710 Utrera, Espagne"
                  onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, address: e.target.value }, geoFailed: false }))} />
              </label>

              {showManualCoords && (
                <>
                  {modal.geoFailed && (
                    <div className="cf-note error">
                      L'adresse n'a pas pu être géolocalisée automatiquement. Tu peux saisir les coordonnées
                      manuellement (latitude / longitude) pour que la ganadería apparaisse sur la carte.
                    </div>
                  )}
                  <span className="cf-subhint">
                    Coordonnées GPS facultatives — utile si l'adresse est introuvable automatiquement, pour
                    que la ganadería apparaisse quand même sur la carte.
                  </span>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <label className="cf-field" style={{ flex: "1 1 140px" }}>
                      <span>Latitude</span>
                      <input className="cf-input" type="number" step="any" value={modal.draft.latitude}
                        onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, latitude: e.target.value } }))} />
                    </label>
                    <label className="cf-field" style={{ flex: "1 1 140px" }}>
                      <span>Longitude</span>
                      <input className="cf-input" type="number" step="any" value={modal.draft.longitude}
                        onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, longitude: e.target.value } }))} />
                    </label>
                  </div>
                </>
              )}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label className="cf-field" style={{ flex: "1 1 150px" }}>
                  <span>Nom du contact (facultatif)</span>
                  <input className="cf-input" value={modal.draft.contactName}
                    onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, contactName: e.target.value } }))} />
                </label>
                <label className="cf-field" style={{ flex: "1 1 150px" }}>
                  <span>Téléphone (facultatif)</span>
                  <input className="cf-input" type="tel" value={modal.draft.contactPhone}
                    onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, contactPhone: e.target.value } }))} />
                </label>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label className="cf-field" style={{ flex: "1 1 150px" }}>
                  <span>Instagram (facultatif, sans @)</span>
                  <input className="cf-input" value={modal.draft.contactInstagram}
                    placeholder="ex. ganaderia_ejemplo"
                    onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, contactInstagram: e.target.value } }))} />
                </label>
                <label className="cf-field" style={{ flex: "1 1 150px" }}>
                  <span>Date du dernier contact (facultatif)</span>
                  <input className="cf-input" type="date" value={modal.draft.lastContactDate}
                    onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, lastContactDate: e.target.value } }))} />
                </label>
              </div>

              <label className="cf-field">
                <span>Commentaires (facultatif)</span>
                <textarea className="cf-area" value={modal.draft.comments}
                  onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, comments: e.target.value } }))} />
              </label>

              {!modal.draft.name.trim() && <span className="cf-hint">Renseignez le nom de la ganadería pour enregistrer.</span>}
            </div>
            <div className="cf-modal-foot">
              <button className="cf-btn cf-btn-ghost" onClick={() => setModal(null)}>Annuler</button>
              <button className="cf-btn cf-btn-primary" onClick={submitModal} disabled={!modal.draft.name.trim() || saving}>
                {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                {modal.mode === "add" ? "Ajouter" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Plus, Heart, Trash2, Pencil, X, RefreshCw,
  ChevronLeft, ChevronRight, CalendarDays, Check, Tags,
  Users, Wallet, Scale, Lock, Loader2, Home, Search, MapPin, List,
} from "lucide-react";
import { api, getStoredCode, storeCode, clearCode } from "./api.js";

/* ─────────────────────────────────────────────────────────────
   Culturafición · Frise de la saison
   Planning collaboratif des événements de l'association.
   Données partagées entre membres du bureau via Cloudflare D1,
   exposées par des Pages Functions (voir /functions/api).
   ───────────────────────────────────────────────────────────── */

const ME_KEY = "culturaficion:planning:me";

const DEFAULT_CATS = [
  { id: "soiree",         label: "Soirée",              color: "#BB322C" },
  { id: "conference",     label: "Conférence",          color: "#355E8A" },
  { id: "tentadero",      label: "Tentadero práctico",  color: "#4A7A3F" },
  { id: "retransmission", label: "Retransmission",      color: "#1F8A8A" },
  { id: "ag",             label: "Assemblée générale",  color: "#8A5A2E" },
  { id: "autre",          label: "Autre",               color: "#6B6258" },
];

const NEW_CAT_COLORS = ["#9E5BA8", "#C77F1A", "#5E7D8A", "#A23E5C", "#3F6E55", "#7A6FB0"];

const MEMBERSHIP_TYPES = {
  tendido:   { label: "Tendido",   color: "#BB322C" },
  practicos: { label: "Prácticos", color: "#B8862E" },
};

const STATUSES = {
  idee:        { label: "Idée",        op: 0.38 },
  a_confirmer: { label: "À confirmer", op: 0.68 },
  confirme:    { label: "Confirmé",    op: 1.0 },
};
const STATUS_KEYS = Object.keys(STATUSES);

const MONTHS_LONG = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const MONTHS_SHORT = ["JANV","FÉVR","MARS","AVR","MAI","JUIN","JUIL","AOÛT","SEPT","OCT","NOV","DÉC"];

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const NEUTRAL = { label: "—", color: "#9a8d7c" };
const eur = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n || 0);
const numOrNull = (v) => { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

function buildMonths(startYear, startMonth) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = (startMonth + i) % 12;
    const y = startYear + Math.floor((startMonth + i) / 12);
    out.push({ m, y, key: `${y}-${String(m + 1).padStart(2, "0")}` });
  }
  return out;
}
function seasonLabel(months) {
  const a = months[0].y, b = months[11].y;
  return a === b ? `${a}` : `${a}–${b}`;
}
function seasonStartYear(seasonKey) {
  return Number(String(seasonKey).split("-")[0]);
}
function seasonKeyFromStart(y) {
  return `${y}-${y + 1}`;
}
function currentSeasonKey() {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 8 ? seasonKeyFromStart(y) : seasonKeyFromStart(y - 1);
}
function fmtDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso + "T00:00:00");
    return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(d);
  } catch { return null; }
}
const normalize = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap');

html, body, #root{
  min-height:100dvh;
  min-height:100vh;
}
html, body{
  margin:0;
  background:radial-gradient(120% 100% at 50% -20%, #F2EAD9 0%, #EDE3D1 55%, #E4D8C0 100%);
  overscroll-behavior-y:none;
}

.cf-root{
  --albero:#EDE3D1; --albero-2:#E4D8C0;
  --sangre:#BB322C; --sangre-deep:#8E211C;
  --oro:#B8862E; --tinta:#1A1413; --blanco:#F8F5EE;
  font-family:'Inter',system-ui,sans-serif; color:var(--tinta);
  background:transparent;
  min-height:100dvh; min-height:100vh;
  padding:18px clamp(12px,3vw,28px) 40px;
}
.cf-root *{box-sizing:border-box}
.cf-display{font-family:'Bebas Neue',sans-serif;letter-spacing:.02em;font-weight:400}

.cf-top{display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px 20px;margin-bottom:6px}
.cf-brand{display:flex;flex-direction:column;line-height:1}
.cf-kicker{font-size:11px;letter-spacing:.42em;text-transform:uppercase;color:var(--sangre);font-weight:600;margin-bottom:6px}
.cf-title{font-family:'Bebas Neue',sans-serif;font-size:clamp(38px,6vw,62px);line-height:.86;letter-spacing:.01em}
.cf-title b{color:var(--sangre)}
.cf-season{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
.cf-season-lab{font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.06em;color:var(--tinta)}
.cf-iconbtn{appearance:none;border:1px solid rgba(26,20,19,.22);background:var(--blanco);color:var(--tinta);
  width:30px;height:30px;border-radius:999px;display:grid;place-items:center;cursor:pointer;transition:.15s}
.cf-iconbtn:hover{border-color:var(--sangre);color:var(--sangre)}
.cf-spacer{flex:1 1 40px}

.cf-viewtoggle{display:flex;gap:6px;align-items:center}
.cf-vt{appearance:none;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:700;letter-spacing:.02em;
  border-radius:999px;padding:8px 15px;border:1px solid rgba(26,20,19,.18);background:var(--blanco);color:#6b6258;
  display:inline-flex;align-items:center;gap:6px;transition:.12s}
.cf-vt[aria-pressed="true"]{background:var(--tinta);color:var(--albero);border-color:var(--tinta)}
.cf-vt:hover{border-color:var(--sangre)}

.cf-accueil{display:flex;justify-content:center;align-items:flex-start;min-height:min(56vh,520px);padding-top:clamp(20px,8vh,90px)}
.cf-accueil-inner{width:min(560px,100%);display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}
.cf-accueil-kicker{font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:var(--sangre);font-weight:600}
.cf-accueil-title{font-family:'Bebas Neue',sans-serif;font-size:clamp(30px,5vw,44px);line-height:.9;letter-spacing:.01em;margin:0 0 6px}
.cf-accueil .cf-search-wrap{width:100%}
.cf-accueil .cf-search-input{padding-top:15px;padding-bottom:15px;font-size:16px;text-align:left}
.cf-suggestions{width:100%;display:flex;flex-direction:column;gap:6px;text-align:left}
.cf-suggestion{appearance:none;cursor:pointer;font-family:inherit;text-align:left;background:var(--blanco);
  border:1px solid rgba(26,20,19,.14);border-radius:11px;padding:11px 14px;display:flex;align-items:center;gap:10px;
  transition:.12s}
.cf-suggestion:hover{border-color:var(--sangre);box-shadow:0 4px 12px rgba(26,20,19,.1)}
.cf-suggestion .dot{width:9px;height:9px;border-radius:3px;flex:none}
.cf-suggestion-title{font-size:14px;font-weight:600;color:var(--tinta);flex:1 1 auto;min-width:0}
.cf-suggestion-meta{font-size:11.5px;color:#7a6f63;white-space:nowrap}
.cf-suggestion-empty{color:#8a7d6e;font-size:13px;padding:16px;text-align:center;border:1px dashed rgba(26,20,19,.2);border-radius:11px}

.cf-home{display:flex;flex-direction:column;gap:12px;margin-top:8px}
.cf-search-wrap{position:relative}
.cf-search-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#9a8d7c;pointer-events:none}
.cf-search-input{width:100%;font-family:inherit;font-size:15px;color:var(--tinta);background:var(--blanco);
  border:1px solid rgba(26,20,19,.18);border-radius:12px;padding:13px 16px 13px 40px;outline:none;transition:.12s}
.cf-search-input:focus{border-color:var(--sangre);box-shadow:0 0 0 3px rgba(187,50,44,.14)}
.cf-search-count{font-size:12px;color:#7a6f63}
.cf-search-list{display:flex;flex-direction:column;gap:9px}
.cf-search-empty{color:#8a7d6e;font-size:13px;padding:22px;text-align:center;border:1px dashed rgba(26,20,19,.2);border-radius:12px}

.cf-search-card{position:relative;cursor:pointer;background:var(--blanco);border-radius:11px;padding:12px 14px 12px 18px;
  border:1px solid rgba(26,20,19,.1);box-shadow:0 1px 2px rgba(26,20,19,.06);overflow:hidden;transition:.14s;
  display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;justify-content:space-between}
.cf-search-card:hover{box-shadow:0 6px 16px rgba(26,20,19,.13);transform:translateY(-1px)}
.cf-search-card .stripe{position:absolute;left:0;top:0;bottom:0;width:5px}
.cf-search-card-main{flex:1 1 220px;min-width:0}
.cf-search-card-stats{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12px;font-weight:600;color:#7a6f63}
.cf-search-card-stats .pos{color:#3F7A4E}
.cf-search-card-stats .neg{color:#BB322C}

.cf-me{display:flex;align-items:center;gap:8px;background:var(--blanco);border:1px solid rgba(26,20,19,.16);
  border-radius:999px;padding:5px 6px 5px 14px}
.cf-me label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7a6f63;white-space:nowrap}
.cf-me input{border:0;background:transparent;font-family:inherit;font-size:14px;font-weight:600;color:var(--tinta);width:120px;outline:none}
.cf-me.flash{animation:cf-flash 1.1s ease}
@keyframes cf-flash{0%,100%{box-shadow:0 0 0 0 rgba(187,50,44,0)}30%{box-shadow:0 0 0 4px rgba(187,50,44,.28)}}

.cf-btn{appearance:none;cursor:pointer;font-family:inherit;font-weight:600;font-size:14px;border-radius:999px;
  padding:9px 18px;display:inline-flex;align-items:center;gap:8px;border:1px solid transparent;transition:.15s}
.cf-btn-primary{background:var(--sangre);color:#fff;box-shadow:0 2px 0 var(--sangre-deep)}
.cf-btn-primary:hover{background:#a82a25}
.cf-btn-primary:active{transform:translateY(1px);box-shadow:0 1px 0 var(--sangre-deep)}
.cf-btn-ghost{background:transparent;border-color:rgba(26,20,19,.2);color:var(--tinta)}
.cf-btn-ghost:hover{border-color:var(--sangre);color:var(--sangre)}
.cf-btn:disabled{opacity:.5;cursor:not-allowed}

.cf-rule{height:3px;background:linear-gradient(90deg,var(--sangre),var(--sangre-deep));border-radius:3px;margin:14px 0 4px;position:relative}
.cf-rule::after{content:"";position:absolute;left:0;right:0;top:6px;height:1px;background:var(--oro);opacity:.5}

.cf-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin:14px 0 8px}
.cf-legend{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cf-chip{appearance:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;border-radius:999px;
  padding:5px 11px 5px 9px;border:1px solid rgba(26,20,19,.18);background:var(--blanco);color:var(--tinta);
  display:inline-flex;align-items:center;gap:7px;transition:.12s;letter-spacing:.01em}
.cf-chip .dot{width:9px;height:9px;border-radius:3px;flex:none}
.cf-chip[aria-pressed="false"]{opacity:.42}
.cf-chip:hover{opacity:1;border-color:rgba(26,20,19,.4)}
.cf-chip.manage{border-style:dashed;color:#7a6f63}
.cf-chip.manage:hover{color:var(--sangre);border-color:var(--sangre)}
.cf-statusfilter{display:flex;gap:6px;margin-left:auto;align-items:center}
.cf-sf{appearance:none;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;letter-spacing:.06em;
  text-transform:uppercase;border-radius:999px;padding:5px 10px;border:1px solid rgba(26,20,19,.18);
  background:var(--blanco);color:#6b6258;transition:.12s}
.cf-sf[aria-pressed="true"]{background:var(--tinta);color:var(--albero);border-color:var(--tinta)}

.cf-frise{display:flex;gap:14px;overflow-x:auto;padding:6px 2px 18px;scroll-snap-type:x proximity}
.cf-month{flex:0 0 234px;scroll-snap-align:start;display:flex;flex-direction:column;min-height:200px}
.cf-month-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:0 2px 8px;
  border-bottom:1px solid rgba(26,20,19,.16);margin-bottom:10px;position:relative}
.cf-month-head::after{content:"";position:absolute;left:0;bottom:-1px;width:34px;height:2px;background:var(--oro)}
.cf-month-name{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:.05em;line-height:1}
.cf-month-year{font-size:11px;color:#9a8d7c;font-weight:600;letter-spacing:.1em}
.cf-month-add{appearance:none;border:1px dashed rgba(26,20,19,.28);background:transparent;color:#8a7d6e;
  border-radius:10px;padding:9px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:6px;transition:.14s;margin-top:auto}
.cf-month-add:hover{border-color:var(--sangre);color:var(--sangre);border-style:solid}
.cf-cards{display:flex;flex-direction:column;gap:9px;flex:1}

.cf-card{position:relative;background:var(--blanco);border-radius:11px;padding:11px 12px 11px 16px;
  border:1px solid rgba(26,20,19,.1);box-shadow:0 1px 2px rgba(26,20,19,.06);overflow:hidden;transition:.14s}
.cf-card:hover{box-shadow:0 6px 16px rgba(26,20,19,.13);transform:translateY(-1px)}
.cf-card .stripe{position:absolute;left:0;top:0;bottom:0;width:5px}
.cf-card.idee{border-style:dashed}
.cf-card-title{font-size:14px;font-weight:600;line-height:1.25;margin-bottom:4px;padding-right:38px}
.cf-card-meta{font-size:11.5px;color:#7a6f63;display:flex;flex-wrap:wrap;gap:3px 9px;align-items:center;margin-bottom:8px}
.cf-card-meta .when{display:inline-flex;align-items:center;gap:3px;color:var(--tinta);font-weight:600}
.cf-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px}
.cf-pill{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:999px;border:1px solid currentColor}
.cf-vote{appearance:none;cursor:pointer;border:0;background:transparent;display:inline-flex;align-items:center;gap:5px;
  font-family:inherit;font-size:12px;font-weight:700;color:#9a8d7c;padding:3px 4px;border-radius:8px;transition:.12s}
.cf-vote:hover{color:var(--sangre)}
.cf-vote.on{color:var(--sangre)}
.cf-card-actions{position:absolute;top:9px;right:9px;display:flex;gap:3px;opacity:0;transition:.14s}
.cf-card:hover .cf-card-actions,.cf-card:focus-within .cf-card-actions{opacity:1}
.cf-act{appearance:none;border:0;background:rgba(26,20,19,.06);color:#6b6258;width:24px;height:24px;border-radius:7px;
  display:grid;place-items:center;cursor:pointer;transition:.12s}
.cf-act:hover{background:var(--sangre);color:#fff}

.cf-empty{flex:0 0 280px;display:flex;flex-direction:column;justify-content:center;gap:10px;color:#8a7d6e;
  border:1px dashed rgba(26,20,19,.2);border-radius:14px;padding:22px;text-align:left}
.cf-empty b{font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:.04em;color:var(--tinta)}

.cf-foot{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;font-size:12px;color:#7a6f63;margin-top:10px}
.cf-count{font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--tinta);letter-spacing:.04em}

.cf-scrim{position:fixed;inset:0;background:rgba(26,20,19,.46);backdrop-filter:blur(2px);display:grid;place-items:center;z-index:50;padding:18px}
.cf-modal{width:min(480px,100%);max-height:92vh;overflow:auto;background:var(--albero);border-radius:18px;
  border:1px solid rgba(26,20,19,.16);box-shadow:0 24px 60px rgba(26,20,19,.4)}
.cf-modal-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 10px}
.cf-modal-head h3{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:.04em;margin:0}
.cf-modal-body{padding:4px 20px 20px;display:flex;flex-direction:column;gap:14px}
.cf-field{display:flex;flex-direction:column;gap:6px}
.cf-field>span{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7a6f63;font-weight:700}
.cf-input,.cf-select,.cf-area{font-family:inherit;font-size:14px;color:var(--tinta);background:var(--blanco);
  border:1px solid rgba(26,20,19,.18);border-radius:10px;padding:10px 12px;outline:none;transition:.12s;width:100%}
.cf-input:focus,.cf-select:focus,.cf-area:focus{border-color:var(--sangre);box-shadow:0 0 0 3px rgba(187,50,44,.14)}
.cf-area{resize:vertical;min-height:62px}
.cf-pickrow{display:flex;flex-wrap:wrap;gap:7px}
.cf-pick{appearance:none;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600;border-radius:9px;
  padding:8px 12px;border:1.5px solid rgba(26,20,19,.16);background:var(--blanco);color:var(--tinta);
  display:inline-flex;align-items:center;gap:7px;transition:.12s}
.cf-pick .dot{width:10px;height:10px;border-radius:3px}
.cf-pick[aria-pressed="true"]{border-color:var(--tinta);background:var(--tinta);color:var(--albero)}
.cf-pick[aria-pressed="true"] .dot{outline:2px solid var(--albero);outline-offset:1px}
.cf-modal-foot{display:flex;gap:10px;justify-content:flex-end;padding:0 20px 20px}
.cf-hint{font-size:12px;color:var(--sangre);font-weight:600}
.cf-subhint{font-size:11.5px;color:#8a7f72;font-weight:500}

.cf-catlist{display:flex;flex-direction:column;gap:8px}
.cf-catrow{display:flex;align-items:center;gap:9px;background:var(--blanco);border:1px solid rgba(26,20,19,.14);
  border-radius:10px;padding:7px 9px}
.cf-swatch{width:28px;height:28px;border-radius:8px;border:1px solid rgba(26,20,19,.22);cursor:pointer;flex:none;
  padding:0;position:relative;overflow:hidden}
.cf-swatch input{position:absolute;inset:-6px;opacity:0;cursor:pointer;width:200%;height:200%}
.cf-catrow input.lab{flex:1;border:0;background:transparent;font-family:inherit;font-size:14px;font-weight:600;
  color:var(--tinta);outline:none;min-width:60px}
.cf-catrow .used{font-size:11px;color:#9a8d7c;white-space:nowrap}
.cf-catrow .cf-act:hover:not(:disabled){background:var(--sangre)}
.cf-act:disabled{opacity:.35;cursor:not-allowed}
.cf-addcat{display:flex;align-items:center;gap:9px;margin-top:2px;padding:7px 9px;border:1px dashed rgba(26,20,19,.28);border-radius:10px}
.cf-note{font-size:12.5px;color:#7a6f63;background:rgba(184,134,46,.12);border:1px solid rgba(184,134,46,.35);
  border-radius:10px;padding:9px 12px;margin:6px 0 2px}
.cf-note.error{color:var(--sangre-deep);background:rgba(187,50,44,.1);border-color:rgba(187,50,44,.4)}

.cf-card{cursor:pointer}
.cf-card-stats{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11.5px;font-weight:600;color:#7a6f63;margin-bottom:8px;
  padding-top:7px;border-top:1px dashed rgba(26,20,19,.12)}
.cf-card-stats .pos{color:#3F7A4E}
.cf-card-stats .neg{color:#BB322C}
.cf-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cf-stat{background:var(--blanco);border:1px solid rgba(26,20,19,.16);border-radius:11px;padding:11px 12px;display:flex;flex-direction:column;gap:6px}
.cf-stat>span{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#7a6f63;font-weight:700;display:flex;align-items:center;gap:5px}
.cf-stat input{border:0;background:transparent;font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:.02em;color:var(--tinta);outline:none;width:100%}
.cf-stat input::-webkit-outer-spin-button,.cf-stat input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.cf-stat.net{grid-column:1 / -1;background:var(--tinta);border-color:var(--tinta)}
.cf-stat.net>span{color:rgba(247,245,238,.72)}
.cf-stat.net .val{font-family:'Bebas Neue',sans-serif;font-size:36px;letter-spacing:.02em}
.cf-stat.ha{background:rgba(53,94,138,.08);border-color:rgba(53,94,138,.22)}
.cf-stat.ha .val{font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:.02em;color:var(--tinta)}
.cf-stat.ha .msg{font-size:12.5px;color:#7a6f63;font-weight:500;display:inline-flex;align-items:center;gap:5px}
.cf-stat.ha .spin{animation:cf-spin 1s linear infinite}
.cf-detail-meta{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:13px;color:#7a6f63;margin-bottom:2px}

.cf-gate{min-height:100vh;display:grid;place-items:center;padding:18px}
.cf-gate-card{width:min(380px,100%);background:var(--blanco);border:1px solid rgba(26,20,19,.16);border-radius:18px;
  box-shadow:0 24px 60px rgba(26,20,19,.22);padding:28px 26px;display:flex;flex-direction:column;gap:16px;align-items:stretch}
.cf-gate-icon{width:46px;height:46px;border-radius:12px;background:var(--sangre);color:#fff;display:grid;place-items:center;margin:0 auto}
.cf-gate-card h1{font-family:'Bebas Neue',sans-serif;font-size:30px;letter-spacing:.03em;text-align:center;margin:0}
.cf-gate-card p{font-size:13px;color:#7a6f63;text-align:center;margin:0}
.cf-gate-error{font-size:12.5px;color:var(--sangre-deep);text-align:center;font-weight:600}
.cf-loading{min-height:100vh;display:grid;place-items:center;gap:10px;color:#7a6f63}
.cf-loading .spin{animation:cf-spin 1s linear infinite}
@keyframes cf-spin{to{transform:rotate(360deg)}}

.cf-memb-list{display:flex;flex-direction:column;gap:8px}
.cf-memb-row{display:flex;align-items:center;gap:12px;background:var(--blanco);border:1px solid rgba(26,20,19,.12);
  border-radius:11px;padding:10px 14px}
.cf-memb-type{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 10px;
  border-radius:999px;color:#fff;flex:none}
.cf-memb-name{font-size:14px;font-weight:600;flex:1 1 auto;min-width:0}
.cf-memb-date{font-size:12px;color:#7a6f63;white-space:nowrap}
.cf-memb-actions{display:flex;gap:3px;flex:none}

.cf-hist-legend{display:flex;gap:16px;align-items:center;font-size:12px;font-weight:600;color:#6b6258;margin:2px 0 6px}
.cf-hist-legend .dot{width:9px;height:9px;border-radius:3px;margin-right:6px}
.cf-hist{display:flex;gap:20px;align-items:flex-end;overflow-x:auto;padding:8px 4px 6px;min-height:160px}
.cf-hist-col{display:flex;flex-direction:column;align-items:center;gap:6px;flex:0 0 60px}
.cf-hist-bars{display:flex;align-items:flex-end;gap:4px;height:120px}
.cf-hist-bar{width:18px;border-radius:4px 4px 0 0;min-height:2px;transition:.2s}
.cf-hist-label{font-size:11px;font-weight:700;color:var(--tinta);white-space:nowrap}
.cf-hist-values{font-size:10.5px;color:#7a6f63;white-space:nowrap}

@media (max-width:640px){
  .cf-frise{flex-direction:column;overflow-x:visible}
  .cf-month{flex:1 1 auto}
  .cf-me input{width:96px}
  .cf-statusfilter{margin-left:0}
  .cf-search-card{flex-direction:column;align-items:flex-start}
  .cf-suggestion{flex-direction:column;align-items:flex-start;gap:4px}
  .cf-memb-row{flex-wrap:wrap}
}
@media (prefers-reduced-motion:reduce){.cf-root *{transition:none!important;animation:none!important}}
.cf-root :focus-visible{outline:2px solid var(--sangre);outline-offset:2px;border-radius:6px}
`;

function loadMe() {
  try { return localStorage.getItem(ME_KEY) || ""; } catch { return ""; }
}
function saveMeLocal(v) {
  try { localStorage.setItem(ME_KEY, v); } catch {}
}

export default function App() {
  // "checking" -> vérifie un code déjà en mémoire | "needed" -> écran de saisie | "ok" -> app
  const [authState, setAuthState] = useState("checking");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [codeInput, setCodeInput] = useState("");

  // "accueil" (recherche rapide) | "liste" (parcours filtrable) | "frise" (planning 12 mois)
  const [view, setView] = useState("accueil");
  const [accueilQuery, setAccueilQuery] = useState("");
  const [listSearch, setListSearch] = useState("");

  const [events, setEvents] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATS);
  const [meta, setMeta] = useState({ startYear: 2026, startMonth: 8 });
  const [me, setMe] = useState(loadMe);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState(() => new Set());
  const [statusFilter, setStatusFilter] = useState(() => new Set(STATUS_KEYS));
  const [modal, setModal] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [statsDraft, setStatsDraft] = useState({ registered: "", revenue: "", expenses: "" });
  const [haStats, setHaStats] = useState({ status: "idle", registered: null, revenue: null });
  const [catModal, setCatModal] = useState(false);
  const [newCat, setNewCat] = useState({ label: "", color: NEW_CAT_COLORS[0] });
  const [nameFlash, setNameFlash] = useState(false);
  const nameRef = useRef(null);

  // Adhésions : saisie manuelle, saison indépendante de celle de la Frise.
  const [membSeasonKey, setMembSeasonKey] = useState(currentSeasonKey);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [membSummary, setMembSummary] = useState([]);
  const [membModal, setMembModal] = useState(null);

  const months = useMemo(() => buildMonths(meta.startYear, meta.startMonth), [meta]);
  const catById = useMemo(() => {
    const m = {};
    categories.forEach((c) => (m[c.id] = c));
    return m;
  }, [categories]);

  const loadState = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api.getState();
      setEvents(data.events || []);
      if (Array.isArray(data.categories) && data.categories.length) setCategories(data.categories);
      if (data.meta) setMeta(data.meta);
      setLoaded(true);
      setAuthState("ok");
      return true;
    } catch (e) {
      if (e.unauthorized) {
        clearCode();
        setAuthState("needed");
      } else {
        setLoadError("Impossible de charger les données. Vérifiez votre connexion et réessayez.");
      }
      return false;
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (getStoredCode()) {
        await loadState();
      } else {
        setAuthState("needed");
      }
    })();
  }, [loadState]);

  const loadMembers = useCallback(async (season) => {
    setMembersError("");
    setMembersLoading(true);
    try {
      const list = await api.listMemberships(season);
      setMembers(list || []);
    } catch (e) {
      if (e.unauthorized) {
        clearCode();
        setAuthState("needed");
      } else {
        setMembersError("Impossible de charger les adhérents. Vérifiez votre connexion et réessayez.");
      }
    } finally {
      setMembersLoading(false);
    }
  }, []);

  const loadMembSummary = useCallback(async () => {
    try {
      const data = await api.getMembershipsSummary();
      setMembSummary(data || []);
    } catch {
      /* l'historique reste tel quel si la requête échoue */
    }
  }, []);

  useEffect(() => {
    if (authState === "ok" && view === "adhesions") loadMembers(membSeasonKey);
  }, [authState, view, membSeasonKey, loadMembers]);

  useEffect(() => {
    if (authState === "ok" && view === "adhesions") loadMembSummary();
  }, [authState, view, loadMembSummary]);

  const submitCode = async (e) => {
    e.preventDefault();
    const code = codeInput.trim();
    if (!code) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const res = await api.verifyCode(code);
      if (res && res.ok) {
        storeCode(code);
        setCodeInput("");
        await loadState();
      } else {
        setAuthError("Code d'accès incorrect.");
      }
    } catch {
      setAuthError("Code d'accès incorrect.");
    } finally {
      setAuthBusy(false);
    }
  };

  const saveMe = (v) => { setMe(v); saveMeLocal(v); };

  const requireName = () => {
    setNameFlash(true);
    nameRef.current && nameRef.current.focus();
    setTimeout(() => setNameFlash(false), 1200);
  };

  const openAdd = (monthKey) => {
    if (!me.trim()) return requireName();
    setModal({ mode: "add", draft: {
      id: uid(), type: categories[0]?.id || "autre", title: "",
      monthKey: monthKey || months[0].key, date: "", lieu: "", helloassoSlug: "", status: "idee",
      notes: "", proposedBy: me.trim(), voters: [],
    }});
  };
  const openEdit = (ev) => setModal({ mode: "edit", draft: { ...ev, voters: ev.voters || [] } });

  const submitModal = async () => {
    const d = modal.draft;
    if (!d.title.trim()) return;
    try {
      if (modal.mode === "add") {
        const created = await api.createEvent({
          id: d.id, type: d.type, title: d.title.trim(), monthKey: d.monthKey,
          date: d.date || null, lieu: d.lieu || null, helloassoSlug: d.helloassoSlug || null,
          status: d.status, proposedBy: d.proposedBy || null,
          notes: d.notes || null,
        });
        setEvents((list) => [...list, created]);
      } else {
        const updated = await api.updateEvent(d.id, {
          type: d.type, title: d.title.trim(), monthKey: d.monthKey, date: d.date || null,
          lieu: d.lieu || null, helloassoSlug: d.helloassoSlug || null, status: d.status, notes: d.notes || null,
        });
        setEvents((list) => list.map((e) => (e.id === d.id ? updated : e)));
      }
      setModal(null);
    } catch (e) {
      alert("Erreur : " + e.message);
    }
  };

  const removeEvent = async (id) => {
    try {
      await api.deleteEvent(id);
      setEvents((list) => list.filter((e) => e.id !== id));
    } catch (e) {
      alert("Erreur : " + e.message);
    }
  };

  const openDetail = (ev) => {
    setDetailId(ev.id);
    setStatsDraft({
      registered: ev.registered != null ? String(ev.registered) : "",
      revenue: ev.revenue != null ? String(ev.revenue) : "",
      expenses: ev.expenses != null ? String(ev.expenses) : "",
    });
    if (ev.helloassoSlug) {
      setHaStats({ status: "loading", registered: null, revenue: null });
      api.getHelloAsso(ev.helloassoSlug)
        .then((res) => setHaStats({ status: "ok", registered: res.registered, revenue: res.revenue }))
        .catch(() => setHaStats({ status: "error", registered: null, revenue: null }));
    } else {
      setHaStats({ status: "idle", registered: null, revenue: null });
    }
  };
  const saveStat = async (id, patch) => {
    setEvents((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    try {
      await api.updateEvent(id, patch);
    } catch (e) {
      alert("Erreur : " + e.message);
    }
  };
  const closeDetail = () => {
    if (detailId) saveStat(detailId, {
      registered: numOrNull(statsDraft.registered),
      revenue: numOrNull(statsDraft.revenue),
      expenses: numOrNull(statsDraft.expenses),
    });
    setDetailId(null);
  };

  const toggleVote = async (id) => {
    if (!me.trim()) return requireName();
    const who = me.trim();
    const current = events.find((e) => e.id === id);
    if (!current) return;
    const voters = current.voters || [];
    const nextVoters = voters.includes(who) ? voters.filter((v) => v !== who) : [...voters, who];
    setEvents((list) => list.map((e) => (e.id === id ? { ...e, voters: nextVoters } : e)));
    try {
      await api.updateEvent(id, { voters: nextVoters });
    } catch (e) {
      setEvents((list) => list.map((x) => (x.id === id ? current : x)));
      alert("Erreur : " + e.message);
    }
  };

  // category operations
  const countUsing = (catId) => events.filter((e) => e.type === catId).length;
  const renameCat = async (id, label) => {
    setCategories((list) => list.map((c) => (c.id === id ? { ...c, label } : c)));
    try { await api.updateCategory(id, { label }); } catch (e) { alert("Erreur : " + e.message); }
  };
  const recolorCat = async (id, color) => {
    setCategories((list) => list.map((c) => (c.id === id ? { ...c, color } : c)));
    try { await api.updateCategory(id, { color }); } catch (e) { alert("Erreur : " + e.message); }
  };
  const deleteCat = async (id) => {
    if (countUsing(id) > 0 || categories.length <= 1) return;
    try {
      await api.deleteCategory(id);
      setCategories((list) => list.filter((c) => c.id !== id));
    } catch (e) {
      alert("Erreur : " + e.message);
    }
  };
  const addCat = async () => {
    const label = newCat.label.trim();
    if (!label) return;
    try {
      const created = await api.createCategory({ id: "cat_" + uid(), label, color: newCat.color });
      setCategories((list) => [...list, created]);
      const nextColor = NEW_CAT_COLORS[(categories.length + 1) % NEW_CAT_COLORS.length];
      setNewCat({ label: "", color: nextColor });
    } catch (e) {
      alert("Erreur : " + e.message);
    }
  };

  const changeMembSeason = (delta) => setMembSeasonKey((k) => seasonKeyFromStart(seasonStartYear(k) + delta));

  const openAddMember = () => {
    setMembModal({
      mode: "add",
      draft: { id: uid(), firstName: "", lastName: "", type: "tendido", seasonKey: membSeasonKey, joinedDate: "" },
    });
  };
  const openEditMember = (m) => setMembModal({ mode: "edit", draft: { ...m } });

  const submitMembModal = async () => {
    const d = membModal.draft;
    if (!d.firstName.trim() || !d.lastName.trim()) return;
    try {
      if (membModal.mode === "add") {
        const created = await api.createMembership({
          id: d.id, firstName: d.firstName.trim(), lastName: d.lastName.trim(),
          type: d.type, seasonKey: d.seasonKey, joinedDate: d.joinedDate || null,
        });
        if (created.seasonKey === membSeasonKey) setMembers((list) => [...list, created]);
      } else {
        const updated = await api.updateMembership(d.id, {
          firstName: d.firstName.trim(), lastName: d.lastName.trim(),
          type: d.type, seasonKey: d.seasonKey, joinedDate: d.joinedDate || null,
        });
        setMembers((list) => {
          if (updated.seasonKey !== membSeasonKey) return list.filter((m) => m.id !== updated.id);
          return list.map((m) => (m.id === updated.id ? updated : m));
        });
      }
      setMembModal(null);
      loadMembSummary();
    } catch (e) {
      alert("Erreur : " + e.message);
    }
  };

  const removeMember = async (id) => {
    try {
      await api.deleteMembership(id);
      setMembers((list) => list.filter((m) => m.id !== id));
      loadMembSummary();
    } catch (e) {
      alert("Erreur : " + e.message);
    }
  };

  const membTotals = useMemo(() => {
    const tendido = members.filter((m) => m.type === "tendido").length;
    const practicos = members.filter((m) => m.type === "practicos").length;
    return { tendido, practicos, total: tendido + practicos };
  }, [members]);

  const membHistMax = Math.max(1, ...membSummary.flatMap((s) => [s.tendido, s.practicos]));

  const persistMeta = async (next) => {
    setMeta(next);
    try { await api.updateMeta(next); } catch (e) { alert("Erreur : " + e.message); }
  };

  const visible = useMemo(
    () => events.filter((e) => !hiddenTypes.has(e.type) && statusFilter.has(e.status)),
    [events, hiddenTypes, statusFilter]
  );
  const byMonth = useMemo(() => {
    const map = {};
    months.forEach((mo) => (map[mo.key] = []));
    visible.forEach((e) => { if (map[e.monthKey]) map[e.monthKey].push(e); });
    Object.values(map).forEach((arr) => arr.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")));
    return map;
  }, [visible, months]);

  const total = events.length;
  const confirmed = events.filter((e) => e.status === "confirme").length;
  const budget = events.reduce((a, e) => {
    a.r += Number(e.revenue) || 0;
    a.d += Number(e.expenses) || 0;
    return a;
  }, { r: 0, d: 0 });
  const netSeason = budget.r - budget.d;

  const toggleHidden = (key) =>
    setHiddenTypes((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleStatus = (key) =>
    setStatusFilter((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const accueilSuggestions = useMemo(() => {
    const q = normalize(accueilQuery.trim());
    if (!q) return [];
    return events
      .filter((e) => normalize(e.title).includes(q))
      .sort((a, b) => {
        const aStarts = normalize(a.title).startsWith(q) ? 0 : 1;
        const bStarts = normalize(b.title).startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.title.localeCompare(b.title);
      })
      .slice(0, 8);
  }, [events, accueilQuery]);

  const listResults = useMemo(() => {
    const q = normalize(listSearch.trim());
    const base = q ? visible.filter((e) => normalize(e.title).includes(q)) : visible;
    return [...base].sort((a, b) => {
      const ak = (a.monthKey || "") + (a.date || "");
      const bk = (b.monthKey || "") + (b.date || "");
      return ak.localeCompare(bk);
    });
  }, [visible, listSearch]);

  if (authState === "checking") {
    return (
      <div className="cf-root">
        <style>{CSS}</style>
        <div className="cf-loading">
          <Loader2 size={28} className="spin" />
          <span>Connexion à la frise…</span>
        </div>
      </div>
    );
  }

  if (authState === "needed") {
    return (
      <div className="cf-root">
        <style>{CSS}</style>
        <div className="cf-gate">
          <form className="cf-gate-card" onSubmit={submitCode}>
            <div className="cf-gate-icon"><Lock size={20} /></div>
            <h1>Frise de la <span style={{ color: "var(--sangre)" }}>saison</span></h1>
            <p>Entrez le code d'accès du bureau de Culturafición pour consulter et modifier le planning.</p>
            <label className="cf-field">
              <span>Code d'accès</span>
              <input className="cf-input" type="password" autoFocus value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)} placeholder="••••••" />
            </label>
            {authError && <span className="cf-gate-error">{authError}</span>}
            <button className="cf-btn cf-btn-primary" type="submit" disabled={authBusy || !codeInput.trim()}
              style={{ justifyContent: "center" }}>
              {authBusy ? "Vérification…" : "Entrer"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="cf-root">
      <style>{CSS}</style>

      <div className="cf-top">
        <div className="cf-brand">
          <span className="cf-kicker">Culturafición · Bureau</span>
          <span className="cf-title">Frise de la <b>saison</b></span>
          <div className="cf-season">
            <button className="cf-iconbtn" aria-label="Année précédente" onClick={() => persistMeta({ ...meta, startYear: meta.startYear - 1 })}>
              <ChevronLeft size={16} />
            </button>
            <span className="cf-season-lab">Saison {seasonLabel(months)}</span>
            <button className="cf-iconbtn" aria-label="Année suivante" onClick={() => persistMeta({ ...meta, startYear: meta.startYear + 1 })}>
              <ChevronRight size={16} />
            </button>
            <select className="cf-select" style={{ width: "auto", padding: "5px 8px", marginLeft: 6 }}
              value={meta.startMonth} onChange={(e) => persistMeta({ ...meta, startMonth: Number(e.target.value) })}
              aria-label="Mois de départ de la saison">
              {MONTHS_LONG.map((m, i) => <option key={i} value={i}>débute en {m}</option>)}
            </select>
          </div>
        </div>
        <div className="cf-viewtoggle">
          <button className="cf-vt" aria-pressed={view === "accueil"} onClick={() => setView("accueil")}>
            <Home size={14} /> Accueil
          </button>
          <button className="cf-vt" aria-pressed={view === "liste"} onClick={() => setView("liste")}>
            <List size={14} /> Liste
          </button>
          <button className="cf-vt" aria-pressed={view === "frise"} onClick={() => setView("frise")}>
            <CalendarDays size={14} /> Frise
          </button>
          <button className="cf-vt" aria-pressed={view === "adhesions"} onClick={() => setView("adhesions")}>
            <Users size={14} /> Adhésions
          </button>
        </div>
        <div className="cf-spacer" />
        <div className={"cf-me" + (nameFlash ? " flash" : "")}>
          <label htmlFor="cf-name">Vous êtes</label>
          <input id="cf-name" ref={nameRef} value={me} placeholder="votre prénom" onChange={(e) => saveMe(e.target.value)} />
        </div>
        <button className="cf-btn cf-btn-ghost"
          onClick={() => { loadState(); if (view === "adhesions") { loadMembers(membSeasonKey); loadMembSummary(); } }}
          title="Récupérer les ajouts des autres membres">
          <RefreshCw size={15} /> Rafraîchir
        </button>
        {view !== "adhesions" && (
          <button className="cf-btn cf-btn-primary" onClick={() => openAdd()}>
            <Plus size={17} /> Ajouter un événement
          </button>
        )}
      </div>

      <div className="cf-rule" />

      {loadError && <div className="cf-note error">{loadError}</div>}

      {view === "accueil" && (
        <div className="cf-accueil">
          <div className="cf-accueil-inner">
            <span className="cf-accueil-kicker">Recherche rapide</span>
            <h1 className="cf-accueil-title">Trouver un <span style={{ color: "var(--sangre)" }}>événement</span></h1>
            <div className="cf-search-wrap">
              <Search size={16} className="cf-search-icon" />
              <input className="cf-search-input" type="search" value={accueilQuery} autoFocus
                onChange={(e) => setAccueilQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && accueilSuggestions.length === 1) {
                    openDetail(accueilSuggestions[0]);
                    setAccueilQuery("");
                  }
                }}
                placeholder="Tapez le nom d'un événement…" aria-label="Rechercher un événement" />
            </div>
            {accueilQuery.trim() && (
              <div className="cf-suggestions">
                {accueilSuggestions.length === 0 && (
                  <div className="cf-suggestion-empty">Aucun événement ne correspond à « {accueilQuery} ».</div>
                )}
                {accueilSuggestions.map((ev) => {
                  const t = catById[ev.type] || NEUTRAL;
                  const when = fmtDate(ev.date);
                  const mo = months.find((m) => m.key === ev.monthKey);
                  return (
                    <button className="cf-suggestion" key={ev.id}
                      onClick={() => { openDetail(ev); setAccueilQuery(""); }}>
                      <span className="dot" style={{ background: t.color }} />
                      <span className="cf-suggestion-title">{ev.title}</span>
                      <span className="cf-suggestion-meta">
                        {mo ? `${MONTHS_LONG[mo.m]} ${mo.y}` : ""}{when ? ` · ${when}` : ""}
                        {ev.lieu ? ` · ${ev.lieu}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {view === "liste" && (
        <div className="cf-controls">
          <div className="cf-legend">
            {categories.map((c) => (
              <button key={c.id} className="cf-chip" aria-pressed={!hiddenTypes.has(c.id)} onClick={() => toggleHidden(c.id)}>
                <span className="dot" style={{ background: c.color }} />
                {c.label}
              </button>
            ))}
            <button className="cf-chip manage" onClick={() => setCatModal(true)}>
              <Tags size={13} /> Catégories
            </button>
          </div>
          <div className="cf-statusfilter">
            {STATUS_KEYS.map((k) => (
              <button key={k} className="cf-sf" aria-pressed={statusFilter.has(k)} onClick={() => toggleStatus(k)}>
                {STATUSES[k].label}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === "liste" && (
        <div className="cf-home">
          <div className="cf-search-wrap">
            <Search size={16} className="cf-search-icon" />
            <input className="cf-search-input" type="search" value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              placeholder="Filtrer par nom d'événement…" aria-label="Filtrer les événements par nom" />
          </div>

          {loaded && total === 0 ? (
            <div className="cf-empty" style={{ flex: "none" }}>
              <b>La saison est encore vierge</b>
              <span>Posez le premier jalon : une soirée, une conférence, un tentadero… Chaque membre du bureau peut ajouter ses propositions, créer ses propres catégories et voter pour les idées des autres.</span>
              <button className="cf-btn cf-btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => openAdd()}>
                <Plus size={16} /> Premier événement
              </button>
            </div>
          ) : (
            <>
              <span className="cf-search-count">
                {listResults.length} événement{listResults.length > 1 ? "s" : ""}
                {listSearch.trim() ? ` trouvé${listResults.length > 1 ? "s" : ""}` : " au programme"}
              </span>
              <div className="cf-search-list">
                {listResults.map((ev) => {
                  const t = catById[ev.type] || NEUTRAL;
                  const st = STATUSES[ev.status] || STATUSES.idee;
                  const when = fmtDate(ev.date);
                  const mo = months.find((m) => m.key === ev.monthKey);
                  const net = (Number(ev.revenue) || 0) - (Number(ev.expenses) || 0);
                  const hasFinance = ev.revenue != null || ev.expenses != null;
                  return (
                    <div className="cf-search-card" key={ev.id} tabIndex={0} role="button"
                      aria-label={"Ouvrir le bilan : " + ev.title}
                      onClick={() => openDetail(ev)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(ev); } }}>
                      <span className="stripe" style={{ background: t.color, opacity: st.op }} />
                      <div className="cf-search-card-main">
                        <div className="cf-card-title">{ev.title}</div>
                        <div className="cf-card-meta">
                          {mo && <span>{MONTHS_LONG[mo.m]} {mo.y}</span>}
                          {when && <span className="when"><CalendarDays size={12} /> {when}</span>}
                          <span style={{ color: t.color, fontWeight: 600 }}>{t.label}</span>
                          {ev.lieu && <span><MapPin size={11} style={{ verticalAlign: -1 }} /> {ev.lieu}</span>}
                        </div>
                      </div>
                      <div className="cf-search-card-stats">
                        <span className="cf-pill" style={{ color: ev.status === "confirme" ? t.color : "#9a8d7c" }}>
                          {ev.status === "confirme" && <Check size={10} style={{ marginRight: 3, verticalAlign: -1 }} />}
                          {st.label}
                        </span>
                        {ev.registered != null && <span>{ev.registered} inscrit{ev.registered > 1 ? "s" : ""}</span>}
                        {hasFinance && <span>Recettes {eur(ev.revenue)} · Dépenses {eur(ev.expenses)}</span>}
                        {hasFinance && (
                          <span className={net >= 0 ? "pos" : "neg"}>Net {net > 0 ? "+" : ""}{eur(net)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {listResults.length === 0 && (
                  <div className="cf-search-empty">Aucun événement ne correspond à « {listSearch} ».</div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {view === "frise" && (
      <>
      <div className="cf-controls">
        <div className="cf-legend">
          {categories.map((c) => (
            <button key={c.id} className="cf-chip" aria-pressed={!hiddenTypes.has(c.id)} onClick={() => toggleHidden(c.id)}>
              <span className="dot" style={{ background: c.color }} />
              {c.label}
            </button>
          ))}
          <button className="cf-chip manage" onClick={() => setCatModal(true)}>
            <Tags size={13} /> Catégories
          </button>
        </div>
        <div className="cf-statusfilter">
          {STATUS_KEYS.map((k) => (
            <button key={k} className="cf-sf" aria-pressed={statusFilter.has(k)} onClick={() => toggleStatus(k)}>
              {STATUSES[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="cf-frise">
        {loaded && total === 0 && (
          <div className="cf-empty">
            <b>La saison est encore vierge</b>
            <span>Posez le premier jalon : une soirée, une conférence, un tentadero… Chaque membre du bureau peut ajouter ses propositions, créer ses propres catégories et voter pour les idées des autres.</span>
            <button className="cf-btn cf-btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => openAdd()}>
              <Plus size={16} /> Premier événement
            </button>
          </div>
        )}

        {months.map((mo) => (
          <div className="cf-month" key={mo.key}>
            <div className="cf-month-head">
              <span className="cf-month-name">{MONTHS_SHORT[mo.m]}</span>
              <span className="cf-month-year">{mo.y}</span>
            </div>
            <div className="cf-cards">
              {byMonth[mo.key].map((ev) => {
                const t = catById[ev.type] || NEUTRAL;
                const st = STATUSES[ev.status] || STATUSES.idee;
                const voted = (ev.voters || []).includes(me.trim());
                const when = fmtDate(ev.date);
                const hasStats = ev.registered != null || ev.revenue != null || ev.expenses != null;
                const cardNet = (Number(ev.revenue) || 0) - (Number(ev.expenses) || 0);
                return (
                  <div className={"cf-card" + (ev.status === "idee" ? " idee" : "")} key={ev.id} tabIndex={0}
                    role="button" aria-label={"Ouvrir le bilan : " + ev.title}
                    onClick={() => openDetail(ev)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(ev); } }}>
                    <span className="stripe" style={{ background: t.color, opacity: st.op }} />
                    <div className="cf-card-actions">
                      <button className="cf-act" aria-label="Modifier" onClick={(e) => { e.stopPropagation(); openEdit(ev); }}><Pencil size={13} /></button>
                      <button className="cf-act" aria-label="Supprimer" onClick={(e) => { e.stopPropagation(); removeEvent(ev.id); }}><Trash2 size={13} /></button>
                    </div>
                    <div className="cf-card-title">{ev.title}</div>
                    <div className="cf-card-meta">
                      {when && <span className="when"><CalendarDays size={12} /> {when}</span>}
                      <span style={{ color: t.color, fontWeight: 600 }}>{t.label}</span>
                      {ev.lieu && <span><MapPin size={11} style={{ verticalAlign: -1 }} /> {ev.lieu}</span>}
                      {ev.proposedBy && <span>· par {ev.proposedBy}</span>}
                    </div>
                    {hasStats && (
                      <div className="cf-card-stats">
                        {ev.registered != null && <span>{ev.registered} inscrit{ev.registered > 1 ? "s" : ""}</span>}
                        {(ev.revenue != null || ev.expenses != null) && (
                          <span className={cardNet >= 0 ? "pos" : "neg"}>{cardNet > 0 ? "+" : ""}{eur(cardNet)}</span>
                        )}
                      </div>
                    )}
                    <div className="cf-card-foot">
                      <span className="cf-pill" style={{ color: ev.status === "confirme" ? t.color : "#9a8d7c" }}>
                        {ev.status === "confirme" && <Check size={10} style={{ marginRight: 3, verticalAlign: -1 }} />}
                        {st.label}
                      </span>
                      <button className={"cf-vote" + (voted ? " on" : "")} onClick={(e) => { e.stopPropagation(); toggleVote(ev.id); }}
                        aria-label="Voter pour cet événement" aria-pressed={voted}>
                        <Heart size={14} fill={voted ? "currentColor" : "none"} />
                        {(ev.voters || []).length || ""}
                      </button>
                    </div>
                  </div>
                );
              })}
              <button className="cf-month-add" onClick={() => openAdd(mo.key)}>
                <Plus size={14} /> Ajouter en {MONTHS_LONG[mo.m]}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="cf-foot">
        <span><span className="cf-count">{total}</span> événement{total > 1 ? "s" : ""} au programme</span>
        <span><span className="cf-count">{confirmed}</span> confirmé{confirmed > 1 ? "s" : ""}</span>
        <span title="Recettes − dépenses sur toute la saison">Net de saison :{" "}
          <span className="cf-count" style={{ color: netSeason >= 0 ? "#3F7A4E" : "#BB322C" }}>
            {netSeason > 0 ? "+" : ""}{eur(netSeason)}
          </span>
        </span>
        <span style={{ marginLeft: "auto", fontStyle: "italic" }}>Événements et catégories sont partagés entre les membres du bureau.</span>
      </div>
      </>
      )}

      {view === "adhesions" && (
        <div className="cf-home">
          <div className="cf-controls">
            <div className="cf-season" style={{ marginTop: 0 }}>
              <button className="cf-iconbtn" aria-label="Saison précédente" onClick={() => changeMembSeason(-1)}>
                <ChevronLeft size={16} />
              </button>
              <span className="cf-season-lab">Saison {membSeasonKey}</span>
              <button className="cf-iconbtn" aria-label="Saison suivante" onClick={() => changeMembSeason(1)}>
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="cf-spacer" />
            <button className="cf-btn cf-btn-primary" onClick={openAddMember}>
              <Plus size={17} /> Ajouter un adhérent
            </button>
          </div>

          {membersError && <div className="cf-note error">{membersError}</div>}

          <div className="cf-stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="cf-stat">
              <span><Users size={13} /> Tendidos</span>
              <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, letterSpacing: ".02em" }}>{membTotals.tendido}</span>
            </div>
            <div className="cf-stat">
              <span><Users size={13} /> Prácticos</span>
              <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, letterSpacing: ".02em" }}>{membTotals.practicos}</span>
            </div>
            <div className="cf-stat net">
              <span><Users size={13} /> Total de la saison</span>
              <span className="val">{membTotals.total}</span>
            </div>
          </div>

          {membersLoading ? (
            <div className="cf-loading" style={{ minHeight: "auto", padding: "26px 0" }}>
              <Loader2 size={22} className="spin" /> <span>Chargement…</span>
            </div>
          ) : members.length === 0 ? (
            <div className="cf-empty" style={{ flex: "none" }}>
              <b>Aucun adhérent pour {membSeasonKey}</b>
              <span>Ajoutez le premier adhérent de cette saison, ou changez de saison pour en consulter une autre.</span>
              <button className="cf-btn cf-btn-primary" style={{ alignSelf: "flex-start" }} onClick={openAddMember}>
                <Plus size={16} /> Premier adhérent
              </button>
            </div>
          ) : (
            <>
              <span className="cf-search-count">
                {members.length} adhérent{members.length > 1 ? "s" : ""} pour {membSeasonKey}
              </span>
              <div className="cf-memb-list">
                {members.map((m) => {
                  const t = MEMBERSHIP_TYPES[m.type] || NEUTRAL;
                  const when = fmtDate(m.joinedDate);
                  return (
                    <div className="cf-memb-row" key={m.id}>
                      <span className="cf-memb-type" style={{ background: t.color }}>{t.label}</span>
                      <span className="cf-memb-name">{m.firstName} {m.lastName}</span>
                      <span className="cf-memb-date">{when || (m.joinedDate ? m.joinedDate : "—")}</span>
                      <div className="cf-memb-actions">
                        <button className="cf-act" aria-label="Modifier" onClick={() => openEditMember(m)}><Pencil size={13} /></button>
                        <button className="cf-act" aria-label="Supprimer" onClick={() => removeMember(m.id)}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="cf-rule" />
          <span className="cf-accueil-kicker" style={{ textAlign: "left" }}>Historique</span>
          <h3 className="cf-display" style={{ margin: "0 0 4px", fontSize: 22 }}>Évolution des effectifs, saison par saison</h3>
          {membSummary.length === 0 ? (
            <div className="cf-empty" style={{ flex: "none" }}>
              <span>L'historique apparaîtra dès qu'une saison aura au moins un adhérent enregistré.</span>
            </div>
          ) : (
            <>
              <div className="cf-hist-legend">
                <span><span className="dot" style={{ background: MEMBERSHIP_TYPES.tendido.color, display: "inline-block" }} />Tendido</span>
                <span><span className="dot" style={{ background: MEMBERSHIP_TYPES.practicos.color, display: "inline-block" }} />Prácticos</span>
              </div>
              <div className="cf-hist">
                {membSummary.map((s) => (
                  <div className="cf-hist-col" key={s.season}>
                    <div className="cf-hist-bars">
                      <div className="cf-hist-bar" style={{ height: `${(s.tendido / membHistMax) * 100}%`, background: MEMBERSHIP_TYPES.tendido.color }}
                        title={`Tendido : ${s.tendido}`} />
                      <div className="cf-hist-bar" style={{ height: `${(s.practicos / membHistMax) * 100}%`, background: MEMBERSHIP_TYPES.practicos.color }}
                        title={`Prácticos : ${s.practicos}`} />
                    </div>
                    <span className="cf-hist-label">{s.season}</span>
                    <span className="cf-hist-values">{s.tendido} / {s.practicos}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* membership modal */}
      {membModal && (
        <div className="cf-scrim" onMouseDown={(e) => e.target === e.currentTarget && setMembModal(null)}>
          <div className="cf-modal" role="dialog" aria-modal="true">
            <div className="cf-modal-head">
              <h3>{membModal.mode === "add" ? "Nouvel adhérent" : "Modifier l'adhérent"}</h3>
              <button className="cf-iconbtn" aria-label="Fermer" onClick={() => setMembModal(null)}><X size={16} /></button>
            </div>
            <div className="cf-modal-body">
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label className="cf-field" style={{ flex: "1 1 150px" }}>
                  <span>Prénom</span>
                  <input className="cf-input" autoFocus value={membModal.draft.firstName}
                    onChange={(e) => setMembModal((mm) => ({ ...mm, draft: { ...mm.draft, firstName: e.target.value } }))}
                    onKeyDown={(e) => e.key === "Enter" && submitMembModal()} />
                </label>
                <label className="cf-field" style={{ flex: "1 1 150px" }}>
                  <span>Nom</span>
                  <input className="cf-input" value={membModal.draft.lastName}
                    onChange={(e) => setMembModal((mm) => ({ ...mm, draft: { ...mm.draft, lastName: e.target.value } }))}
                    onKeyDown={(e) => e.key === "Enter" && submitMembModal()} />
                </label>
              </div>
              <div className="cf-field">
                <span>Type d'adhésion</span>
                <div className="cf-pickrow">
                  {Object.entries(MEMBERSHIP_TYPES).map(([key, t]) => (
                    <button key={key} className="cf-pick" aria-pressed={membModal.draft.type === key}
                      onClick={() => setMembModal((mm) => ({ ...mm, draft: { ...mm.draft, type: key } }))}>
                      <span className="dot" style={{ background: t.color }} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label className="cf-field" style={{ flex: "1 1 150px" }}>
                  <span>Date d'adhésion (facultatif)</span>
                  <input type="date" className="cf-input" value={membModal.draft.joinedDate || ""}
                    onChange={(e) => setMembModal((mm) => ({ ...mm, draft: { ...mm.draft, joinedDate: e.target.value } }))} />
                </label>
                <div className="cf-field" style={{ flex: "1 1 150px" }}>
                  <span>Saison</span>
                  <div className="cf-season" style={{ marginTop: 2 }}>
                    <button type="button" className="cf-iconbtn" aria-label="Saison précédente"
                      onClick={() => setMembModal((mm) => ({ ...mm, draft: { ...mm.draft, seasonKey: seasonKeyFromStart(seasonStartYear(mm.draft.seasonKey) - 1) } }))}>
                      <ChevronLeft size={16} />
                    </button>
                    <span className="cf-season-lab">{membModal.draft.seasonKey}</span>
                    <button type="button" className="cf-iconbtn" aria-label="Saison suivante"
                      onClick={() => setMembModal((mm) => ({ ...mm, draft: { ...mm.draft, seasonKey: seasonKeyFromStart(seasonStartYear(mm.draft.seasonKey) + 1) } }))}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
              {(!membModal.draft.firstName.trim() || !membModal.draft.lastName.trim()) && (
                <span className="cf-hint">Renseignez le prénom et le nom pour enregistrer.</span>
              )}
            </div>
            <div className="cf-modal-foot">
              <button className="cf-btn cf-btn-ghost" onClick={() => setMembModal(null)}>Annuler</button>
              <button className="cf-btn cf-btn-primary" onClick={submitMembModal}>
                <Check size={16} /> {membModal.mode === "add" ? "Ajouter" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* event modal */}
      {modal && (
        <div className="cf-scrim" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="cf-modal" role="dialog" aria-modal="true">
            <div className="cf-modal-head">
              <h3>{modal.mode === "add" ? "Nouvel événement" : "Modifier l'événement"}</h3>
              <button className="cf-iconbtn" aria-label="Fermer" onClick={() => setModal(null)}><X size={16} /></button>
            </div>
            <div className="cf-modal-body">
              <div className="cf-field">
                <span>Type</span>
                <div className="cf-pickrow">
                  {categories.map((c) => (
                    <button key={c.id} className="cf-pick" aria-pressed={modal.draft.type === c.id}
                      onClick={() => setModal((m) => ({ ...m, draft: { ...m.draft, type: c.id } }))}>
                      <span className="dot" style={{ background: c.color }} />
                      {c.label}
                    </button>
                  ))}
                  <button className="cf-pick" style={{ borderStyle: "dashed", color: "#7a6f63" }}
                    onClick={() => setCatModal(true)}>
                    <Plus size={13} /> Nouvelle catégorie
                  </button>
                </div>
              </div>
              <label className="cf-field">
                <span>Intitulé</span>
                <input className="cf-input" autoFocus value={modal.draft.title}
                  placeholder="ex. Conférence avec la Commission Taurine d'Orthez"
                  onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, title: e.target.value } }))}
                  onKeyDown={(e) => e.key === "Enter" && submitModal()} />
              </label>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label className="cf-field" style={{ flex: "1 1 150px" }}>
                  <span>Mois</span>
                  <select className="cf-select" value={modal.draft.monthKey}
                    onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, monthKey: e.target.value } }))}>
                    {months.map((mo) => <option key={mo.key} value={mo.key}>{MONTHS_LONG[mo.m]} {mo.y}</option>)}
                  </select>
                </label>
                <label className="cf-field" style={{ flex: "1 1 150px" }}>
                  <span>Date précise (facultatif)</span>
                  <input type="date" className="cf-input" value={modal.draft.date || ""}
                    onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, date: e.target.value } }))} />
                </label>
              </div>
              <label className="cf-field">
                <span>Lieu (facultatif)</span>
                <input className="cf-input" value={modal.draft.lieu || ""}
                  placeholder="ex. Salle des fêtes, Orthez"
                  onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, lieu: e.target.value } }))} />
              </label>
              <label className="cf-field">
                <span>Identifiant HelloAsso (billetterie, facultatif)</span>
                <input className="cf-input" value={modal.draft.helloassoSlug || ""}
                  placeholder="ex. conference-orthez-2026"
                  onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, helloassoSlug: e.target.value } }))} />
                <span className="cf-subhint">Le nom de la billetterie tel qu'il apparaît dans son URL HelloAsso.</span>
              </label>
              <div className="cf-field">
                <span>Statut</span>
                <div className="cf-pickrow">
                  {STATUS_KEYS.map((k) => (
                    <button key={k} className="cf-pick" aria-pressed={modal.draft.status === k}
                      onClick={() => setModal((m) => ({ ...m, draft: { ...m.draft, status: k } }))}>
                      {STATUSES[k].label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="cf-field">
                <span>Notes (lieu, intervenants, idées…)</span>
                <textarea className="cf-area" value={modal.draft.notes}
                  onChange={(e) => setModal((m) => ({ ...m, draft: { ...m.draft, notes: e.target.value } }))} />
              </label>
              {!modal.draft.title.trim() && <span className="cf-hint">Donnez un intitulé pour enregistrer.</span>}
            </div>
            <div className="cf-modal-foot">
              <button className="cf-btn cf-btn-ghost" onClick={() => setModal(null)}>Annuler</button>
              <button className="cf-btn cf-btn-primary" onClick={submitModal}>
                <Check size={16} /> {modal.mode === "add" ? "Ajouter à la frise" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* category manager */}
      {catModal && (
        <div className="cf-scrim" onMouseDown={(e) => e.target === e.currentTarget && setCatModal(false)}>
          <div className="cf-modal" role="dialog" aria-modal="true">
            <div className="cf-modal-head">
              <h3>Catégories d'événements</h3>
              <button className="cf-iconbtn" aria-label="Fermer" onClick={() => setCatModal(false)}><X size={16} /></button>
            </div>
            <div className="cf-modal-body">
              <p style={{ margin: 0, fontSize: 13, color: "#7a6f63" }}>
                Renommez, recolorez ou ajoutez vos propres types. La liste est partagée avec tout le bureau.
              </p>
              <div className="cf-catlist">
                {categories.map((c) => {
                  const used = countUsing(c.id);
                  const blocked = used > 0 || categories.length <= 1;
                  return (
                    <div className="cf-catrow" key={c.id}>
                      <label className="cf-swatch" style={{ background: c.color }} aria-label={"Couleur de " + c.label}>
                        <input type="color" value={c.color} onChange={(e) => recolorCat(c.id, e.target.value)} />
                      </label>
                      <input className="lab" value={c.label} onChange={(e) => renameCat(c.id, e.target.value)} aria-label="Nom de la catégorie" />
                      {used > 0 && <span className="used">{used} évén.</span>}
                      <button className="cf-act" aria-label="Supprimer la catégorie" disabled={blocked}
                        title={used > 0 ? "Utilisée par des événements — videz-la d'abord" : (categories.length <= 1 ? "Au moins une catégorie requise" : "Supprimer")}
                        onClick={() => deleteCat(c.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="cf-addcat">
                <label className="cf-swatch" style={{ background: newCat.color }} aria-label="Couleur de la nouvelle catégorie">
                  <input type="color" value={newCat.color} onChange={(e) => setNewCat((n) => ({ ...n, color: e.target.value }))} />
                </label>
                <input className="cf-input" style={{ flex: 1 }} placeholder="Nouvelle catégorie (ex. Voyage à une feria)"
                  value={newCat.label} onChange={(e) => setNewCat((n) => ({ ...n, label: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && addCat()} />
                <button className="cf-btn cf-btn-primary" onClick={addCat} disabled={!newCat.label.trim()}>
                  <Plus size={15} /> Ajouter
                </button>
              </div>
            </div>
            <div className="cf-modal-foot">
              <button className="cf-btn cf-btn-ghost" onClick={() => setCatModal(false)}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* event detail / bilan */}
      {detailId && (() => {
        const ev = events.find((e) => e.id === detailId);
        if (!ev) return null;
        const t = catById[ev.type] || NEUTRAL;
        const when = fmtDate(ev.date);
        const mo = months.find((m) => m.key === ev.monthKey);
        const r = Number(statsDraft.revenue) || 0;
        const d = Number(statsDraft.expenses) || 0;
        const net = r - d;
        return (
          <div className="cf-scrim" onMouseDown={(e) => e.target === e.currentTarget && closeDetail()}>
            <div className="cf-modal" role="dialog" aria-modal="true">
              <div className="cf-modal-head">
                <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: t.color, flex: "none" }} />
                  {ev.title}
                </h3>
                <button className="cf-iconbtn" aria-label="Fermer" onClick={closeDetail}><X size={16} /></button>
              </div>
              <div className="cf-modal-body">
                <div className="cf-detail-meta">
                  <span style={{ color: t.color, fontWeight: 700 }}>{t.label}</span>
                  <span>{mo ? `${MONTHS_LONG[mo.m]} ${mo.y}` : ""}{when ? ` · ${when}` : ""}</span>
                  {ev.lieu && <span><MapPin size={12} style={{ verticalAlign: -1 }} /> {ev.lieu}</span>}
                  <span>· {STATUSES[ev.status]?.label}</span>
                  {ev.proposedBy && <span>· par {ev.proposedBy}</span>}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Heart size={12} /> {(ev.voters || []).length}
                  </span>
                </div>
                {ev.notes && <p style={{ margin: "2px 0 4px", fontSize: 13, color: "#5d5349", whiteSpace: "pre-wrap" }}>{ev.notes}</p>}

                <div className="cf-field"><span>Bilan de l'événement</span></div>
                <div className="cf-stats">
                  <label className="cf-stat">
                    <span><Users size={13} /> Inscrits</span>
                    <input type="number" min="0" inputMode="numeric" placeholder="0" value={statsDraft.registered}
                      onChange={(e) => setStatsDraft((s) => ({ ...s, registered: e.target.value }))}
                      onBlur={() => saveStat(ev.id, { registered: numOrNull(statsDraft.registered) })} />
                  </label>
                  <label className="cf-stat">
                    <span><Wallet size={13} /> Recettes (€)</span>
                    <input type="number" step="0.01" inputMode="decimal" placeholder="0" value={statsDraft.revenue}
                      onChange={(e) => setStatsDraft((s) => ({ ...s, revenue: e.target.value }))}
                      onBlur={() => saveStat(ev.id, { revenue: numOrNull(statsDraft.revenue) })} />
                  </label>
                  <label className="cf-stat">
                    <span><Wallet size={13} /> Dépenses (€)</span>
                    <input type="number" step="0.01" inputMode="decimal" placeholder="0" value={statsDraft.expenses}
                      onChange={(e) => setStatsDraft((s) => ({ ...s, expenses: e.target.value }))}
                      onBlur={() => saveStat(ev.id, { expenses: numOrNull(statsDraft.expenses) })} />
                  </label>
                  {ev.helloassoSlug && (
                    <div className="cf-stat ha">
                      <span><Users size={13} /> Inscrits HelloAsso</span>
                      {haStats.status === "loading" && (
                        <span className="msg"><Loader2 size={13} className="spin" /> Chargement…</span>
                      )}
                      {haStats.status === "error" && <span className="msg">Données HelloAsso indisponibles</span>}
                      {haStats.status === "ok" && <span className="val">{haStats.registered}</span>}
                    </div>
                  )}
                  {ev.helloassoSlug && (
                    <div className="cf-stat ha">
                      <span><Wallet size={13} /> Recettes HelloAsso</span>
                      {haStats.status === "loading" && (
                        <span className="msg"><Loader2 size={13} className="spin" /> Chargement…</span>
                      )}
                      {haStats.status === "error" && <span className="msg">Données HelloAsso indisponibles</span>}
                      {haStats.status === "ok" && <span className="val">{eur(haStats.revenue)}</span>}
                    </div>
                  )}
                  <div className="cf-stat net">
                    <span><Scale size={13} /> Résultat net</span>
                    <span className="val" style={{ color: net >= 0 ? "#7FB98A" : "#E98A84" }}>
                      {net > 0 ? "+" : ""}{eur(net)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="cf-modal-foot">
                <button className="cf-btn cf-btn-ghost" onClick={() => { const cur = ev; closeDetail(); openEdit(cur); }}>
                  <Pencil size={15} /> Modifier l'événement
                </button>
                <button className="cf-btn cf-btn-primary" onClick={closeDetail}><Check size={16} /> Terminé</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

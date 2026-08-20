import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Plus, Heart, Trash2, Pencil, X, RefreshCw,
  ChevronLeft, ChevronRight, CalendarDays, Check, Tags,
  Users, Wallet, Scale, Lock, Unlock, Loader2, Home, Search, MapPin, List,
  Landmark, FileDown, FileSpreadsheet, ExternalLink, AlertTriangle,
  ReceiptText, Eye, EyeOff, BookOpen, Menu, Beef,
} from "lucide-react";
import { api, getStoredCode, storeCode, clearCode } from "./api.js";
import Ganaderias from "./Ganaderias.jsx";

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

const NAV_ITEMS = [
  { id: "accueil",   label: "Accueil",       Icon: Home },
  { id: "liste",     label: "Liste",         Icon: List },
  { id: "frise",     label: "Frise",         Icon: CalendarDays },
  { id: "adhesions", label: "Adhésions",     Icon: Users },
  { id: "compta",    label: "Comptabilité",  Icon: Landmark },
  { id: "ganaderias", label: "Ganaderías",   Icon: Beef },
];

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
function fmtDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso + "T00:00:00");
    return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(d);
  } catch { return null; }
}
CUSTOM_NORMALIZE_LINE_PLACEHOLDER

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap');

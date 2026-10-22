import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

// ---------- Storage ----------
const SUPABASE_URL = "https://hpycqegogkqsodvykqfj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhweWNxZWdvZ2txc29kdnlrcWZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTUxMTcsImV4cCI6MjA4OTUzMTExN30.Rb5r_9gsNNVIl0e9dqYraYJdDayvunqEMfQ_I8FmfKI";
// v2 lives in its own row so the previous version's data is never overwritten
const ROW_ID_V2 = "main_v2";
const ROW_ID_V1 = "main";
const LOCAL_KEY_V2 = "invoiceflow_data_backup_v2";
const LOCAL_KEY_V1 = "invoiceflow_data_backup";
const DEFAULT_MODEL_URL = "https://docs.google.com/spreadsheets/d/1K1jWmG5_Nde-T13edPxSNWXFCIESaODXQnD0RoufEPM/edit?gid=968918111#gid=968918111";
const COMPANY_FILE_PREFIX = "Fiat_Growth";

async function loadRow(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/invoiceflow_data?id=eq.${id}&select=data`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase load failed: ${res.status}`);
  const rows = await res.json();
  return rows?.[0]?.data || null;
}
async function saveRow(id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/invoiceflow_data?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ id, data, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase save failed: ${res.status} ${await res.text()}`);
}
function loadLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
function saveLocal(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // storage unavailable or full, Supabase remains the source of truth
  }
}

// ---------- Formatting ----------
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function fmt(n) {
  const v = Number(n || 0);
  const s = "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? "-" + s : s;
}
function fmtSigned(n) {
  const v = round2(n);
  return (v > 0 ? "+" : "") + fmt(v);
}
function fmtPct(cur, prev) {
  if (!prev) return cur ? "New" : "n/a";
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  return (p > 0 ? "+" : "") + p.toFixed(1) + "%";
}
function varColor(diff) {
  if (Math.abs(diff) < 0.005) return "text-gray-400";
  return diff > 0 ? "text-emerald-600" : "text-red-500";
}

// ---------- Months (canonical key: YYYY-MM) ----------
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function ymFromParts(y, m0) {
  return `${y}-${String(m0 + 1).padStart(2, "0")}`;
}
function ymSplit(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  return { y, m0: m - 1 };
}
function ymLabel(ym) {
  if (!ym) return "";
  const { y, m0 } = ymSplit(ym);
  return `${MONTHS_SHORT[m0]} ${y}`;
}
function ymLong(ym) {
  if (!ym) return "";
  const { y, m0 } = ymSplit(ym);
  return `${MONTHS_LONG[m0]} ${y}`;
}
function ymAdd(ym, n) {
  const { y, m0 } = ymSplit(ym);
  const t = y * 12 + m0 + n;
  return ymFromParts(Math.floor(t / 12), ((t % 12) + 12) % 12);
}
function currentYm() {
  const d = new Date();
  return ymFromParts(d.getFullYear(), d.getMonth());
}
function daysInYm(ym) {
  const { y, m0 } = ymSplit(ym);
  return new Date(y, m0 + 1, 0).getDate();
}
function monthIndexFromName(name) {
  const k = String(name).toLowerCase().slice(0, 3);
  return MONTHS_SHORT.findIndex(m => m.toLowerCase() === k);
}
function fullYear(s) {
  const n = Number(s);
  return String(s).length === 2 ? 2000 + n : n;
}
function validYm(y, m0) {
  if (!y || y < 2000 || y > 2100 || m0 < 0 || m0 > 11) return null;
  return ymFromParts(y, m0);
}
// Header cell to month key. Accepts Date, "Jan 2026", "January 2026", "Jan-26", "1/1/2026", "2026-01-01", "01/2026"
function parseMonthCell(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return ymFromParts(v.getFullYear(), v.getMonth());
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[T ].*)?$/);
  if (m) return validYm(Number(m[1]), Number(m[2]) - 1);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) return validYm(fullYear(m[3]), Number(m[1]) - 1);
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return validYm(Number(m[2]), Number(m[1]) - 1);
  m = s.match(/^([A-Za-z]{3,9})\.?[\s\-'’,]+(\d{2}|\d{4})$/);
  if (m) {
    const idx = monthIndexFromName(m[1]);
    if (idx >= 0) return validYm(fullYear(m[2]), idx);
  }
  return null;
}
// Data cell to Date. Accepts Date, Excel serial, "10/01/2026", "2026-10-01"
function parseDateCell(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const p = XLSX.SSF.parse_date_code(v);
    if (p) return new Date(p.y, p.m - 1, p.d);
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) return new Date(fullYear(m[3]), Number(m[1]) - 1, Number(m[2]));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}
function isoDate(d) {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromIso(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function usDate(d) {
  if (!d) return "";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}
function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

// ---------- Parsing helpers ----------
// Returns a number, or null when the cell has no number. Handles $, commas, (1,000) and -$1,000
function parseAmount(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s || !/\d/.test(s)) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /^\$\s*-/.test(s);
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}
const NAME_SUFFIXES = new Set(["inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "pllc", "plc", "pc", "lp", "llp", "pbc"]);
// Normalized client key used to match the model, QBO and approvals: ignores case, punctuation and LLC/Inc
function clientKey(name) {
  const s = String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'’"()]/g, " ")
    .replace(/[^a-z0-9: ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const key = s
    .split(":")
    .map(seg => seg.trim().split(" ").filter(t => t && !NAME_SUFFIXES.has(t)).join(" "))
    .join(":");
  return key || s;
}
function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function similar(a, b) {
  const x = slug(a);
  const y = slug(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
function parseTsv(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map(r => r.split("\t"));
}
async function readSpreadsheetFile(file, preferSheet) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const name = (preferSheet && wb.SheetNames.find(n => preferSheet.test(n))) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
  return { rows, sheetName: name };
}

// ---------- Financial model (Forecasted Revenue tab) ----------
function modelCsvUrl(sheetUrl) {
  const id = String(sheetUrl).match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  const gid = String(sheetUrl).match(/gid=(\d+)/)?.[1] || "0";
  if (!id) throw new Error("That does not look like a Google Sheets link.");
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1&gid=${gid}`;
}
function makeLineId(name, service, department) {
  return `${clientKey(name)}|${slug(service)}|${slug(department)}`;
}
function parseModelRows(rows) {
  const hIdx = rows.findIndex((r, i) => i < 30 && (r || []).some(c => String(c).trim().toLowerCase() === "client name"));
  if (hIdx < 0) throw new Error('Could not find the "Client Name" header. Make sure the data comes from the Forecasted Revenue tab.');
  const header = rows[hIdx];
  const find = re => header.findIndex(h => typeof h === "string" && re.test(h.trim()));
  const cClient = find(/^client name$/i);
  const cService = find(/^service$/i);
  const cDept = find(/^(department|dept)$/i);
  const cLead = find(/^lead$/i);
  const monthCols = [];
  const seen = new Set();
  header.forEach((h, i) => {
    const ym = parseMonthCell(h);
    if (ym && !seen.has(ym)) {
      seen.add(ym);
      monthCols.push({ i, ym });
    }
  });
  if (!monthCols.length) throw new Error("No month columns found in the header (expected Jan 2026, Feb 2026, ...).");
  const lines = [];
  const idCount = {};
  let totals = null;
  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = String(row[cClient] ?? "").trim();
    if (!name) continue;
    if (/^(grand\s+)?totals?$/i.test(name)) {
      totals = Object.fromEntries(monthCols.map(({ i, ym }) => [ym, round2(parseAmount(row[i]) || 0)]));
      break;
    }
    const amounts = {};
    let any = false;
    monthCols.forEach(({ i, ym }) => {
      const a = parseAmount(row[i]);
      if (a) {
        amounts[ym] = round2(a);
        any = true;
      }
    });
    if (!any) continue;
    const service = cService >= 0 ? String(row[cService] ?? "").trim() : "";
    const department = cDept >= 0 ? String(row[cDept] ?? "").trim() : "";
    const lead = cLead >= 0 ? String(row[cLead] ?? "").trim() : "";
    const baseId = makeLineId(name, service, department);
    idCount[baseId] = (idCount[baseId] || 0) + 1;
    const id = idCount[baseId] > 1 ? `${baseId}#${idCount[baseId]}` : baseId;
    lines.push({ id, clientName: name, service, department, lead, amounts });
  }
  if (!lines.length) throw new Error("No client rows with amounts were found.");
  return { lines, totals, months: monthCols.map(m => m.ym) };
}

// ---------- QBO report (actuals) ----------
const QBO_COLS = {
  date: [/^(transaction )?date$/i, /^invoice date$/i],
  type: [/^(transaction )?type$/i],
  num: [/^num$/i, /^no\.?$/i, /^invoice (no\.?|number|#)$/i, /^number$/i, /^ref(erence)? ?(no\.?|number)?$/i, /^doc(ument)? ?(no\.?|number)$/i],
  customer: [/^customer( full name| name)?$/i, /^name$/i, /^client$/i],
  item: [/^product\/service( full name| name)?$/i, /^item( name)?$/i, /^product( or service)?$/i],
  description: [/^memo\/description$/i, /^(line |product\/service )?description$/i],
  qty: [/^(qty|quantity)$/i],
  rate: [/^(sales price|rate|price|unit price)$/i],
  amount: [/^amount$/i, /^(line )?amount( \(usd\))?$/i, /^total( amount)?$/i],
  class: [/^class( full name| name)?$/i],
  location: [/^location( full name| name)?$/i],
  terms: [/^terms$/i],
  dueDate: [/^due date$/i],
};
function mapQboHeader(header) {
  const cols = {};
  Object.entries(QBO_COLS).forEach(([key, patterns]) => {
    for (const re of patterns) {
      const idx = header.findIndex(h => typeof h === "string" && re.test(h.trim()));
      if (idx >= 0) {
        cols[key] = idx;
        break;
      }
    }
  });
  return cols;
}
function parseQboRows(rows) {
  // Detail reports (Sales by Customer Detail, Transaction List, Invoice List)
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const header = (rows[i] || []).map(c => (typeof c === "string" ? c.trim() : c));
    const cols = mapQboHeader(header);
    if (cols.date !== undefined && cols.amount !== undefined) return parseQboDetail(rows, i, cols);
  }
  // Summary reports with one column per month (Sales by Customer Summary by month)
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const header = rows[i] || [];
    const monthCols = header.map((h, idx) => ({ idx, ym: parseMonthCell(h) })).filter(x => x.ym);
    if (monthCols.length) return parseQboSummary(rows, i, monthCols);
  }
  throw new Error("Could not recognize the QBO report. Export Sales by Customer Detail (or Transaction List by Customer) with Date, Num, Customer, Product/Service, Description, Class and Amount columns.");
}
function parseQboDetail(rows, hIdx, cols) {
  const lines = [];
  let group = "";
  const get = (row, key) => (cols[key] === undefined ? "" : row[cols[key]]);
  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const first = String(row.find(c => String(c).trim() !== "") ?? "").trim();
    const date = parseDateCell(get(row, "date"));
    const amount = parseAmount(get(row, "amount"));
    if (!date || amount === null) {
      if (first && !/^total/i.test(first) && !/^(tota|report|cash|accrual|basis)/i.test(first)) group = first;
      continue;
    }
    const type = String(get(row, "type") || "").trim();
    if (type && !/invoice|sales receipt|credit memo|refund/i.test(type)) continue;
    const customer = String(get(row, "customer") || "").trim() || group;
    if (!customer) continue;
    const due = parseDateCell(get(row, "dueDate"));
    lines.push({
      ym: ymFromParts(date.getFullYear(), date.getMonth()),
      date: isoDate(date),
      dueDate: due ? isoDate(due) : "",
      type,
      num: String(get(row, "num") ?? "").trim(),
      customer,
      item: String(get(row, "item") || "").trim(),
      description: String(get(row, "description") || "").trim(),
      qty: parseAmount(get(row, "qty")),
      rate: parseAmount(get(row, "rate")),
      amount: round2(amount),
      class: String(get(row, "class") || "").trim(),
      location: String(get(row, "location") || "").trim(),
      terms: String(get(row, "terms") || "").trim(),
    });
  }
  if (!lines.length) throw new Error("The report has a header row but no invoice lines with a date and amount.");
  return { mode: "detail", lines };
}
function parseQboSummary(rows, hIdx, monthCols) {
  const lines = [];
  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const customer = String(row[0] ?? "").trim();
    if (!customer || /^total/i.test(customer)) continue;
    monthCols.forEach(({ idx, ym }) => {
      const a = parseAmount(row[idx]);
      if (a) lines.push({ ym, date: "", dueDate: "", type: "Summary", num: "", customer, item: "", description: "", qty: null, rate: null, amount: round2(a), class: "", location: "", terms: "", summary: true });
    });
  }
  if (!lines.length) throw new Error("The summary report has month columns but no customer amounts.");
  return { mode: "summary", lines };
}

// ---------- Description roll forward ----------
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function rollDescription(text, fromYm, toYm) {
  if (!text || !fromYm || !toYm || fromYm === toYm) return text || "";
  const f = ymSplit(fromYm);
  const t = ymSplit(toYm);
  const fy = String(f.y);
  const ty = String(t.y);
  const pairs = [
    [`${MONTHS_LONG[f.m0]} ${fy}`, `${MONTHS_LONG[t.m0]} ${ty}`],
    [`${MONTHS_SHORT[f.m0]} ${fy}`, `${MONTHS_SHORT[t.m0]} ${ty}`],
    [`${MONTHS_SHORT[f.m0]} ${fy.slice(2)}`, `${MONTHS_SHORT[t.m0]} ${ty.slice(2)}`],
    [`${MONTHS_SHORT[f.m0]}-${fy.slice(2)}`, `${MONTHS_SHORT[t.m0]}-${ty.slice(2)}`],
    [`${String(f.m0 + 1).padStart(2, "0")}/${fy}`, `${String(t.m0 + 1).padStart(2, "0")}/${ty}`],
    [`${f.m0 + 1}/${fy}`, `${t.m0 + 1}/${ty}`],
  ];
  let out = text;
  const tokens = [];
  pairs.forEach(([from, to], i) => {
    const re = new RegExp(`\\b${escapeRe(from)}\\b`, "gi");
    out = out.replace(re, () => {
      tokens.push(to);
      return `\u0000${tokens.length - 1}\u0000`;
    });
  });
  out = out.replace(new RegExp(`\\b${MONTHS_LONG[f.m0]}\\b`, "g"), MONTHS_LONG[t.m0]);
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}
function parseTermsDays(terms) {
  const s = String(terms || "").toLowerCase();
  const m = s.match(/net\s*(\d+)/);
  if (m) return Number(m[1]);
  if (/receipt/.test(s)) return 0;
  return null;
}

// ---------- Data shape ----------
const DEPT_DEFAULT_LEADS = { "fiat finance": "Kaley", uncovered: "Nick" };
function getDefaultLead(dept) {
  return DEPT_DEFAULT_LEADS[String(dept || "").toLowerCase().trim()] || "";
}
function defaultBillingMonth() {
  return ymAdd(currentYm(), 1);
}
function emptyData() {
  return {
    version: 2,
    forecast: { lines: [], totals: null, syncedAt: "", source: "", sheetUrl: DEFAULT_MODEL_URL },
    actuals: { lines: [], uploads: [] },
    customerMap: {},
    overrides: {},
    manualLines: {},
    leadOverrides: {},
    approvers: [],
    approvalHistory: {},
    closedMonths: [],
    billingMonth: defaultBillingMonth(),
    invoiceFieldMemory: {},
    exportSettings: { autoNumber: false },
    clientSort: "az",
    savedAt: "",
  };
}
function normalizeData(d) {
  const base = emptyData();
  if (!d || d.version !== 2) return base;
  return {
    ...base,
    ...d,
    forecast: { ...base.forecast, ...(d.forecast || {}) },
    actuals: { ...base.actuals, ...(d.actuals || {}) },
    exportSettings: { ...base.exportSettings, ...(d.exportSettings || {}) },
  };
}
function oldKeyToYm(key) {
  return parseMonthCell(key) || (/^\d{4}-\d{2}$/.test(String(key)) ? key : null);
}
// Converts data saved by the previous dashboard version into the v2 shape
function migrateV1(v1) {
  const d = emptyData();
  if (!v1) return d;
  const idCount = {};
  (v1.clients || []).forEach(client => {
    (client.lines || []).forEach(line => {
      const amounts = {};
      Object.entries(line.amounts || {}).forEach(([k, v]) => {
        const ym = oldKeyToYm(k);
        if (ym && Number(v)) amounts[ym] = round2(v);
      });
      if (!Object.keys(amounts).length) return;
      const baseId = makeLineId(client.name, line.service, line.department);
      idCount[baseId] = (idCount[baseId] || 0) + 1;
      const id = idCount[baseId] > 1 ? `${baseId}#${idCount[baseId]}` : baseId;
      d.forecast.lines.push({ id, clientName: client.name, service: line.service || "", department: line.department || "", lead: "", amounts });
    });
    if (client.lead) d.leadOverrides[clientKey(client.name)] = client.lead;
  });
  d.forecast.source = d.forecast.lines.length ? "Carried over from the previous dashboard version. Sync the financial model to refresh." : "";
  d.approvers = v1.approvers || [];
  const history = v1.approvalHistory || {};
  Object.entries(history).forEach(([monthKey, entries]) => {
    const ym = oldKeyToYm(monthKey);
    if (!ym) return;
    d.approvalHistory[ym] = d.approvalHistory[ym] || {};
    Object.entries(entries || {}).forEach(([oldKey, entry]) => {
      d.approvalHistory[ym][clientKey(oldKey)] = { ...entry };
    });
  });
  d.closedMonths = (v1.closedMonths || [])
    .filter(m => typeof m === "object" && m)
    .map(m => ({ ...m, monthKey: oldKeyToYm(m.monthKey) || m.monthKey, previousMonthKey: oldKeyToYm(m.previousMonthKey) || m.previousMonthKey }));
  const savedMonth = oldKeyToYm(v1.approvalMonthKey || v1.curColKey || "");
  d.billingMonth = savedMonth && savedMonth >= currentYm() ? savedMonth : defaultBillingMonth();
  return d;
}
function setIn(obj, path, value) {
  const [head, ...rest] = path;
  const src = obj || {};
  if (!rest.length) {
    const next = { ...src };
    if (value === undefined) delete next[head];
    else next[head] = value;
    return next;
  }
  return { ...src, [head]: setIn(src[head], rest, value) };
}
function downloadBlob(content, fileName, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function toCsv(rows) {
  return rows.map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
}

// ---------- UI atoms ----------
function Badge({ status }) {
  const s = {
    pending: "bg-amber-50 text-amber-700",
    approved: "bg-blue-50 text-blue-700",
    sent: "bg-purple-50 text-purple-700",
    rejected: "bg-red-50 text-red-700",
    "see notes": "bg-orange-50 text-orange-600",
    edited: "bg-blue-50 text-blue-600",
    removed: "bg-gray-100 text-gray-500",
    added: "bg-emerald-50 text-emerald-700",
    actuals: "bg-emerald-50 text-emerald-700",
    forecast: "bg-gray-100 text-gray-500",
  };
  const label = status === "sent" ? "Exported" : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${s[status] || "bg-gray-100 text-gray-500"}`}>{label}</span>;
}
function Modal({ title, onClose, children, size }) {
  const width = size === "xl" ? "max-w-6xl" : size === "wide" ? "max-w-3xl" : "max-w-md";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-20 p-4">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${width} p-6 max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function EditableAmount({ value, onSave, disabled, muted }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const ref = useRef(null);
  function start() {
    if (disabled) return;
    setVal(String(value || 0));
    setEditing(true);
    setTimeout(() => ref.current?.select(), 30);
  }
  function save() {
    const n = parseAmount(val);
    if (n !== null) onSave(round2(n));
    setEditing(false);
  }
  if (editing) {
    return (
      <input
        ref={ref}
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-28 border border-blue-300 rounded px-2 py-0.5 text-right text-xs outline-none bg-blue-50"
      />
    );
  }
  return (
    <span
      onClick={start}
      title={disabled ? "" : "Click to edit"}
      className={`${disabled ? "" : "cursor-pointer hover:bg-blue-50 hover:text-blue-700"} px-1 py-0.5 rounded transition-colors font-medium ${muted ? "text-gray-300 line-through" : "text-gray-800"}`}
    >
      {fmt(value)}
    </span>
  );
}
function EditableText({ value, onSave, placeholder, disabled, className }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const ref = useRef(null);
  function start() {
    if (disabled) return;
    setVal(String(value || ""));
    setEditing(true);
    setTimeout(() => ref.current?.select(), 30);
  }
  function save() {
    if (val.trim() !== String(value || "")) onSave(val.trim());
    setEditing(false);
  }
  if (editing) {
    return (
      <input
        ref={ref}
        value={val}
        placeholder={placeholder || ""}
        onChange={e => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className={`border border-blue-300 rounded px-2 py-0.5 text-xs outline-none bg-blue-50 ${className || "w-28"}`}
      />
    );
  }
  return (
    <span
      onClick={start}
      title={disabled ? "" : "Click to edit"}
      className={`${disabled ? "" : "cursor-pointer hover:bg-blue-50 hover:text-blue-700"} px-1 py-0.5 rounded transition-colors whitespace-nowrap ${value ? "text-gray-600" : "text-gray-300"}`}
    >
      {value || placeholder || "n/a"}
    </span>
  );
}
function StatCard({ label, value, sub, color }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${color || "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}
function Card({ title, subtitle, right, children, tone }) {
  const border = tone === "red" ? "border-red-100" : tone === "green" ? "border-emerald-100" : "border-gray-100";
  const titleColor = tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-700" : "text-gray-800";
  return (
    <div className={`bg-white rounded-2xl border ${border} overflow-hidden`}>
      <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className={`font-medium ${titleColor}`}>{title}</h2>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

// ---------- Billing model ----------
// Departments left out of this dashboard, both from the financial model and from QBO actuals
const EXCLUDED_DEPARTMENTS = [/fiat finance/i];
function isExcludedDept(value) {
  const v = String(value || "");
  return EXCLUDED_DEPARTMENTS.some(re => re.test(v));
}
function lineAmountFor(line, ym, overrides) {
  const ov = overrides?.[ym]?.[line.id];
  if (ov?.removed) return 0;
  if (ov && ov.amount !== undefined) return ov.amount;
  return line.amounts?.[ym] || 0;
}
function buildBillingModel(data) {
  const M = data.billingMonth;
  const P = ymAdd(M, -1);
  const allForecastLines = data.forecast.lines || [];
  // clients whose model lines are all in an excluded department (used to drop their QBO actuals when QBO has no class)
  const deptsByClient = {};
  allForecastLines.forEach(l => (deptsByClient[clientKey(l.clientName)] = deptsByClient[clientKey(l.clientName)] || []).push(l.department));
  const excludedClients = new Set(Object.entries(deptsByClient).filter(([, ds]) => ds.every(isExcludedDept)).map(([k]) => k));
  const forecastLines = allForecastLines.filter(l => !isExcludedDept(l.department));
  const modelNames = {};
  forecastLines.forEach(l => {
    const k = clientKey(l.clientName);
    if (!modelNames[k]) modelNames[k] = l.clientName;
  });
  Object.values(data.manualLines || {}).forEach(list =>
    (list || []).forEach(l => {
      const k = clientKey(l.clientName);
      if (!modelNames[k]) modelNames[k] = l.clientName;
    })
  );
  // QBO customer to client key
  const autoKey = qboName => {
    const k = clientKey(qboName);
    if (modelNames[k]) return { key: k, matched: true };
    if (qboName.includes(":")) {
      const parent = clientKey(qboName.split(":")[0]);
      if (modelNames[parent]) return { key: parent, matched: true };
    }
    return { key: k, matched: false };
  };
  const resolveCustomer = qboName => {
    const mapped = data.customerMap?.[qboName];
    if (mapped) return mapped;
    return autoKey(qboName).key;
  };
  const actualLines = (data.actuals.lines || []).filter(l => !isExcludedDept(l.class) && !excludedClients.has(resolveCustomer(l.customer)));
  const actualMonths = new Set(actualLines.map(l => l.ym));
  const actualsByYm = {};
  const actualLinesByClient = {};
  const latestQboName = {};
  const latestQboDate = {};
  const qboCustomers = {};
  actualLines.forEach(l => {
    const key = resolveCustomer(l.customer);
    actualsByYm[l.ym] = actualsByYm[l.ym] || {};
    actualsByYm[l.ym][key] = round2((actualsByYm[l.ym][key] || 0) + l.amount);
    (actualLinesByClient[key] = actualLinesByClient[key] || []).push(l);
    const sortDate = l.date || `${l.ym}-01`;
    if (!latestQboDate[key] || sortDate >= latestQboDate[key]) {
      latestQboDate[key] = sortDate;
      latestQboName[key] = l.customer;
    }
    if (!qboCustomers[l.customer]) qboCustomers[l.customer] = { name: l.customer, ...autoKey(l.customer), total: 0 };
    qboCustomers[l.customer].total = round2(qboCustomers[l.customer].total + l.amount);
  });
  Object.values(actualLinesByClient).forEach(list => list.sort((a, b) => String(b.date || b.ym).localeCompare(String(a.date || a.ym))));

  const prevSource = actualMonths.has(P) ? "actuals" : "forecast";
  const clients = {};
  const ensure = (key, name) => {
    if (!clients[key]) clients[key] = { key, name: modelNames[key] || name, lines: [], amount: 0, prevAmount: 0, departments: new Set() };
    return clients[key];
  };
  forecastLines.forEach(line => {
    const key = clientKey(line.clientName);
    const modelAmount = line.amounts?.[M] || 0;
    const ov = data.overrides?.[M]?.[line.id];
    if (!modelAmount && !ov) return;
    const amount = lineAmountFor(line, M, data.overrides);
    const c = ensure(key, line.clientName);
    c.lines.push({ ...line, modelAmount, amount, edited: !!ov && !ov.removed, removed: !!ov?.removed, manual: false });
    if (amount && line.department) c.departments.add(line.department);
  });
  (data.manualLines?.[M] || []).filter(line => !isExcludedDept(line.department)).forEach(line => {
    const key = clientKey(line.clientName);
    const c = ensure(key, line.clientName);
    c.lines.push({ ...line, modelAmount: 0, amount: line.amount, manual: true });
    if (line.department) c.departments.add(line.department);
  });
  // previous month amounts
  if (prevSource === "actuals") {
    Object.entries(actualsByYm[P] || {}).forEach(([key, amt]) => {
      ensure(key, latestQboName[key] || key).prevAmount = amt;
    });
  } else {
    forecastLines.forEach(line => {
      const a = lineAmountFor(line, P, data.overrides);
      if (a) {
        const c = ensure(clientKey(line.clientName), line.clientName);
        c.prevAmount = round2(c.prevAmount + a);
      }
    });
    (data.manualLines?.[P] || []).forEach(line => {
      const c = ensure(clientKey(line.clientName), line.clientName);
      c.prevAmount = round2(c.prevAmount + (line.amount || 0));
    });
  }
  const leadFor = c => {
    if (data.leadOverrides?.[c.key]) return data.leadOverrides[c.key];
    const fromModel = c.lines.find(l => l.lead)?.lead;
    if (fromModel) return fromModel;
    const deptLead = c.lines.map(l => getDefaultLead(l.department)).find(Boolean);
    return deptLead || "";
  };
  const rows = Object.values(clients).map(c => {
    const amount = round2(c.lines.reduce((s, l) => s + (l.amount || 0), 0));
    return {
      ...c,
      amount,
      departments: [...c.departments],
      lead: leadFor(c),
      diff: round2(amount - c.prevAmount),
      qboName: latestQboName[c.key] || "",
    };
  });
  const active = rows.filter(r => Math.abs(r.amount) > 0.004 || Math.abs(r.prevAmount) > 0.004);
  const lost = active.filter(r => Math.abs(r.amount) < 0.005 && Math.abs(r.prevAmount) > 0.004);
  const added = active.filter(r => Math.abs(r.amount) > 0.004 && Math.abs(r.prevAmount) < 0.005);
  const total = round2(active.reduce((s, r) => s + r.amount, 0));
  const prevTotal = round2(active.reduce((s, r) => s + r.prevAmount, 0));
  const monthSet = new Set([M, P, currentYm(), ymAdd(currentYm(), 1)]);
  forecastLines.forEach(l => Object.keys(l.amounts || {}).forEach(k => monthSet.add(k)));
  actualMonths.forEach(m => monthSet.add(m));
  const monthOptions = [...monthSet].sort();
  const modelTotalForM = allForecastLines.reduce((s, l) => s + (l.amounts?.[M] || 0), 0);
  return {
    M,
    P,
    prevSource,
    rows: active,
    lost,
    added,
    total,
    prevTotal,
    monthOptions,
    modelNames,
    qboCustomers: Object.values(qboCustomers),
    actualLinesByClient,
    actualsByYm,
    actualMonths: [...actualMonths].sort(),
    latestQboName,
    modelTotalForM: round2(modelTotalForM),
  };
}

// ---------- QBO import file ----------
function pickTemplate(billingLine, templateLines) {
  if (!templateLines.length) return null;
  const s = billingLine.service;
  const byItem = templateLines.find(t => t.item && similar(t.item.split(":").pop(), s));
  if (byItem) return byItem;
  const byDesc = templateLines.find(t => t.description && s && slug(t.description).includes(slug(s)));
  if (byDesc) return byDesc;
  const items = [...new Set(templateLines.map(t => t.item))];
  if (items.length === 1) return templateLines[0];
  const byClass = templateLines.filter(t => t.class && similar(t.class.split(":").pop(), billingLine.department));
  if (byClass.length && new Set(byClass.map(t => t.item)).size === 1) return byClass[0];
  return null;
}
function buildExport(data, bm, options) {
  const M = data.billingMonth;
  const memory = data.invoiceFieldMemory || {};
  const allActual = data.actuals.lines || [];
  const usesClass = allActual.some(l => l.class);
  const usesLocation = allActual.some(l => l.location);
  const statusOf = key => data.approvalHistory?.[M]?.[key]?.status || "pending";
  const included = bm.rows.filter(r => Math.abs(r.amount) > 0.004).filter(r => {
    const st = statusOf(r.key);
    if (options.scope === "all") return true;
    if (options.scope === "approved_sent") return st === "approved" || st === "sent";
    return st === "approved";
  });
  // invoice date
  let invoiceDate = fromIso(options.invoiceDate);
  if (!invoiceDate) {
    const { y, m0 } = ymSplit(M);
    invoiceDate = new Date(y, m0, 1);
  }
  // numbering
  const maxNum = allActual.reduce((mx, l) => (/^\d+$/.test(l.num) ? Math.max(mx, Number(l.num)) : mx), 0);
  let nextNo = options.autoNumber ? null : Number(options.startNo) || maxNum + 1;
  const invoices = [];
  const exceptions = [];
  const sorted = [...included].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  sorted.forEach(client => {
    const history = (bm.actualLinesByClient[client.key] || []).filter(l => !l.summary);
    const templateYm = history[0]?.ym || "";
    const templateLines = history.filter(l => l.ym === templateYm);
    const customerMemory = memory[`customer|${client.key}`] || {};
    const customer = customerMemory.customer || client.qboName || client.name;
    const lastTerms = history.find(l => l.terms)?.terms || "";
    const lastWithDue = history.find(l => l.dueDate && l.date);
    const lines = [];
    client.lines
      .filter(l => !l.removed && Math.abs(l.amount) > 0.004)
      .forEach(l => {
        const t = pickTemplate(l, templateLines);
        const mem = memory[l.id] || {};
        const memDesc = mem.description ? rollDescription(mem.description, mem.descriptionYm || M, M) : "";
        const tDesc = t?.description ? rollDescription(t.description, t.ym, M) : "";
        const line = {
          lineId: l.id,
          service: l.service,
          department: l.department,
          item: mem.item ?? t?.item ?? "",
          description: memDesc || tDesc || `${l.service || "Services"}, ${ymLong(M)}`,
          class: mem.class ?? t?.class ?? "",
          qty: 1,
          rate: round2(l.amount),
          amount: round2(l.amount),
          location: t?.location || "",
          templateFound: !!t,
        };
        lines.push(line);
        if (!line.item) exceptions.push({ type: "Missing Product/Service", customer, detail: `${l.service || "Line"} ${fmt(l.amount)}, set the QBO item before importing` });
        if (usesClass && !line.class) exceptions.push({ type: "Missing Class", customer, detail: `${l.service || "Line"} ${fmt(l.amount)}, set the QBO class before importing` });
      });
    if (!lines.length) return;
    const terms = customerMemory.terms ?? lastTerms;
    const termDays = parseTermsDays(terms);
    let due = null;
    if (termDays !== null) due = addDays(invoiceDate, termDays);
    else if (lastWithDue) {
      const gap = Math.round((fromIso(lastWithDue.dueDate) - fromIso(lastWithDue.date)) / 86400000);
      if (Number.isFinite(gap)) due = addDays(invoiceDate, gap);
    }
    invoices.push({
      key: client.key,
      no: nextNo === null ? "" : String(nextNo++),
      customer,
      clientName: client.name,
      date: invoiceDate,
      due,
      terms,
      location: lines[0]?.location || "",
      lines,
      total: round2(lines.reduce((s, l) => s + l.amount, 0)),
      prevAmount: client.prevAmount,
      newCustomer: !history.length && !client.qboName,
    });
    if (!history.length && !client.qboName) exceptions.push({ type: "New customer", customer, detail: "No invoices for this customer in the QBO actuals. Confirm the exact QBO customer name before importing." });
    if (client.prevAmount && Math.abs(client.amount - client.prevAmount) / Math.abs(client.prevAmount) > 0.1)
      exceptions.push({ type: "Variance over 10%", customer, detail: `${fmt(client.prevAmount)} in ${ymLabel(bm.P)} vs ${fmt(client.amount)} in ${ymLabel(M)} (${fmtPct(client.amount, client.prevAmount)})` });
  });
  bm.rows
    .filter(r => Math.abs(r.amount) > 0.004 && !included.includes(r))
    .forEach(r => exceptions.push({ type: "Not included", customer: r.qboName || r.name, detail: `${fmt(r.amount)}, approval status is ${statusOf(r.key)}` }));
  bm.lost.forEach(r => exceptions.push({ type: "No billing this month", customer: r.qboName || r.name, detail: `Billed ${fmt(r.prevAmount)} in ${ymLabel(bm.P)}, nothing in ${ymLabel(M)}` }));
  const priority = ["Missing Product/Service", "Missing Class", "New customer", "Variance over 10%", "No billing this month", "Not included"];
  exceptions.sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type));
  const actionable = exceptions.filter(e => e.type !== "Not included").length;
  const total = round2(invoices.reduce((s, i) => s + i.total, 0));
  return { invoices, exceptions, actionable, total, usesLocation, usesClass, maxNum, invoiceDate };
}
function exportCsv(exp, M) {
  const cols = ["InvoiceNo", "Customer", "InvoiceDate", "DueDate", "Terms"];
  if (exp.usesLocation) cols.push("Location");
  cols.push("Memo", "Item(Product/Service)", "ItemDescription", "ItemQuantity", "ItemRate", "ItemAmount", "Class");
  const rows = [cols];
  exp.invoices.forEach(inv => {
    inv.lines.forEach(l => {
      const r = [inv.no, inv.customer, usDate(inv.date), usDate(inv.due), inv.terms];
      if (exp.usesLocation) r.push(inv.location);
      r.push("", l.item, l.description, "1", l.amount.toFixed(2), l.amount.toFixed(2), l.class);
      rows.push(r);
    });
  });
  downloadBlob("﻿" + toCsv(rows), `${COMPANY_FILE_PREFIX}_Invoices_Import_${M}.csv`, "text/csv;charset=utf-8");
}
function exportReviewWorkbook(exp, bm, data) {
  const M = data.billingMonth;
  const recon = [["Customer", `${ymLabel(bm.P)} (${bm.prevSource === "actuals" ? "QBO actuals" : "forecast"})`, ymLabel(M), "Variance", "Variance %", "Approval status", "Comment"]];
  [...bm.rows]
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
    .forEach(r => {
      const entry = data.approvalHistory?.[M]?.[r.key] || {};
      recon.push([r.qboName || r.name, r.prevAmount, r.amount, r.diff, r.prevAmount ? round2((r.diff / Math.abs(r.prevAmount)) * 100) / 100 : "", entry.status || (r.amount ? "pending" : ""), entry.comment || ""]);
    });
  recon.push(["Total", bm.prevTotal, bm.total, round2(bm.total - bm.prevTotal), bm.prevTotal ? round2((bm.total - bm.prevTotal) / Math.abs(bm.prevTotal) * 10000) / 10000 : "", "", ""]);
  const exc = [["Type", "Customer", "Detail"], ...exp.exceptions.map(e => [e.type, e.customer, e.detail])];
  const lines = [["InvoiceNo", "Customer", "Service", "Department", "Item(Product/Service)", "Description", "Class", "Amount"]];
  exp.invoices.forEach(inv => inv.lines.forEach(l => lines.push([inv.no, inv.customer, l.service, l.department, l.item, l.description, l.class, l.amount])));
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(recon);
  ws1["!cols"] = [{ wch: 44 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 40 }];
  for (let r = 1; r < recon.length; r++) {
    ["B", "C", "D"].forEach(c => {
      const cell = ws1[`${c}${r + 1}`];
      if (cell && typeof cell.v === "number") cell.z = "#,##0.00;(#,##0.00)";
    });
    const pct = ws1[`E${r + 1}`];
    if (pct && typeof pct.v === "number") pct.z = "0.0%";
  }
  const ws2 = XLSX.utils.aoa_to_sheet(exc);
  ws2["!cols"] = [{ wch: 24 }, { wch: 44 }, { wch: 90 }];
  const ws3 = XLSX.utils.aoa_to_sheet(lines);
  ws3["!cols"] = [{ wch: 10 }, { wch: 40 }, { wch: 22 }, { wch: 16 }, { wch: 30 }, { wch: 50 }, { wch: 18 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Reconciliation");
  XLSX.utils.book_append_sheet(wb, ws2, "Exceptions");
  XLSX.utils.book_append_sheet(wb, ws3, "Invoice Lines");
  XLSX.writeFile(wb, `${COMPANY_FILE_PREFIX}_Invoice_Review_${M}.xlsx`);
}

// ---------- App ----------
export default function App() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(emptyData);
  const dataRef = useRef(data);
  const saveChain = useRef(Promise.resolve());
  const pending = useRef(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("billing");
  const [expanded, setExpanded] = useState({});
  const [sortMode, setSortMode] = useState("az");
  const [showAddLine, setShowAddLine] = useState(false);
  const [newLine, setNewLine] = useState({ clientName: "", service: "", department: "", amount: "" });
  const [showApprove, setShowApprove] = useState(null);
  const [approveComment, setApproveComment] = useState("");
  const [approveApprover, setApproveApprover] = useState("");
  const [showLines, setShowLines] = useState(null);
  const [filterLead, setFilterLead] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closeAnyway, setCloseAnyway] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [selectedClosed, setSelectedClosed] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [exportOpts, setExportOpts] = useState({ scope: "approved", invoiceDate: "", autoNumber: false, startNo: "" });
  const [modelUrl, setModelUrl] = useState(DEFAULT_MODEL_URL);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [actualsMsg, setActualsMsg] = useState("");
  const [actualsError, setActualsError] = useState("");
  const [leadPaste, setLeadPaste] = useState("");
  const [showAllMappings, setShowAllMappings] = useState(false);

  // ---------- persistence: every change is re-applied on top of the latest saved data, so concurrent approvals are never overwritten ----------
  function commit(updater) {
    const next = updater(dataRef.current);
    dataRef.current = next;
    setData(next);
    pending.current += 1;
    setSaving(true);
    saveChain.current = saveChain.current.then(async () => {
      let merged = dataRef.current;
      let remoteOk = true;
      try {
        const remote = await loadRow(ROW_ID_V2);
        if (remote && remote.version === 2) merged = updater(normalizeData(remote));
      } catch {
        remoteOk = false;
      }
      merged = { ...merged, savedAt: new Date().toISOString() };
      saveLocal(LOCAL_KEY_V2, merged);
      try {
        if (!remoteOk) throw new Error("load failed");
        await saveRow(ROW_ID_V2, merged);
        setSaveError("");
      } catch (e) {
        console.error(e);
        setSaveError("Saved locally. Supabase save failed.");
      }
      pending.current -= 1;
      if (pending.current === 0) {
        if (remoteOk) {
          dataRef.current = merged;
          setData(merged);
        }
        setSaving(false);
      }
    });
  }

  useEffect(() => {
    (async () => {
      let d = null;
      let err = "";
      try {
        d = await loadRow(ROW_ID_V2);
        if (!d) {
          const v1 = await loadRow(ROW_ID_V1);
          if (v1) d = migrateV1(v1);
        }
      } catch (e) {
        console.error(e);
        err = "Could not reach Supabase, showing the local backup.";
        d = loadLocal(LOCAL_KEY_V2);
        if (!d) {
          const v1 = loadLocal(LOCAL_KEY_V1);
          if (v1) d = migrateV1(v1);
        }
      }
      const norm = normalizeData(d);
      dataRef.current = norm;
      setData(norm);
      setModelUrl(norm.forecast.sheetUrl || DEFAULT_MODEL_URL);
      setSortMode(norm.clientSort || "az");
      setSaveError(err);
      setLoading(false);
    })();
  }, []);

  const bm = useMemo(() => buildBillingModel(data), [data]);
  const M = data.billingMonth;
  const P = bm.P;
  const isClosed = (data.closedMonths || []).some(m => m.monthKey === M);
  const approvalEntry = key => data.approvalHistory?.[M]?.[key] || {};

  const sortRows = list => {
    const arr = [...list];
    if (sortMode === "amount") return arr.sort((a, b) => b.amount - a.amount);
    if (sortMode === "variance") return arr.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    if (sortMode === "za") return arr.sort((a, b) => b.name.localeCompare(a.name, "en", { sensitivity: "base" }));
    return arr.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  };

  // ---------- approvals ----------
  const approvalBase = bm.rows
    .filter(r => Math.abs(r.amount) > 0.004)
    .map(r => {
      const e = approvalEntry(r.key);
      return {
        ...r,
        status: e.status || "pending",
        comment: e.comment || "",
        approver: e.approver || r.lead || data.approvers[0] || "",
        approvedAmount: e.amount,
        changedSinceApproval: ["approved", "sent"].includes(e.status) && e.amount !== undefined && Math.abs(e.amount - r.amount) > 0.004,
      };
    });
  const approvers = [...new Set([...(data.approvers || []), ...bm.rows.map(r => r.lead).filter(Boolean)])];
  const approvalLeads = ["all", ...new Set(approvalBase.map(r => r.lead || "No lead"))];
  const approvalStatuses = ["all", "pending", "approved", "see notes", "rejected", "sent"];
  const filteredApprovals = sortRows(
    approvalBase.filter(r => filterLead === "all" || (r.lead || "No lead") === filterLead).filter(r => filterStatus === "all" || r.status === filterStatus)
  );
  const pendingCount = approvalBase.filter(r => r.status === "pending").length;
  const approvedCount = approvalBase.filter(r => r.status === "approved" || r.status === "sent").length;
  // Rejected invoices are a decision (not billed), so only pending and see notes hold the close
  const blockers = approvalBase.filter(r => r.status === "pending" || r.status === "see notes");
  const canClose = approvalBase.length > 0;
  const statusByKey = Object.fromEntries(approvalBase.map(r => [r.key, r.status]));

  function saveApproval(key, patch) {
    commit(d => setIn(d, ["approvalHistory", M, key], { ...(d.approvalHistory?.[M]?.[key] || {}), ...patch, at: new Date().toISOString() }));
  }
  function decide(decision) {
    if (!showApprove) return;
    saveApproval(showApprove.key, { status: decision, comment: approveComment, approver: approveApprover || showApprove.approver || "", amount: showApprove.amount });
    setShowApprove(null);
    setApproveComment("");
  }
  function openReview(r) {
    setShowApprove(r);
    setApproveComment(r.comment || "");
    setApproveApprover(r.approver || "");
  }
  // Deletes every approval of the selected month and, if it was closed, its closed month record
  function resetApprovals() {
    commit(d => ({ ...setIn(d, ["approvalHistory", M], undefined), closedMonths: (d.closedMonths || []).filter(m => m.monthKey !== M) }));
    setShowClearConfirm(false);
    setNotice(`All ${ymLabel(M)} approvals were deleted.`);
  }
  function reopenMonth() {
    commit(d => ({ ...d, closedMonths: (d.closedMonths || []).filter(m => m.monthKey !== M) }));
    setNotice(`${ymLabel(M)} reopened. Approvals were kept.`);
  }
  function closeMonth() {
    if (!canClose || (blockers.length && !closeAnyway)) return;
    const billed = approvalBase.filter(r => r.status !== "rejected");
    const record = {
      monthKey: M,
      monthLabel: ymLabel(M),
      previousMonthKey: P,
      previousMonthLabel: ymLabel(P),
      closedAt: new Date().toISOString(),
      total: round2(billed.reduce((s, r) => s + r.amount, 0)),
      invoiceCount: billed.length,
      approvedCount: approvalBase.filter(r => r.status === "approved").length,
      sentCount: approvalBase.filter(r => r.status === "sent").length,
      invoices: approvalBase.map(r => ({
        id: `${M}-${r.key}`,
        clientName: r.name,
        lead: r.lead,
        approver: r.approver,
        status: r.status,
        comment: r.comment,
        amount: r.amount,
        lastAmount: r.prevAmount,
        lines: r.lines.filter(l => !l.removed && l.amount).map(l => ({ service: l.service, department: l.department, amount: l.amount })),
      })),
    };
    const next = ymAdd(M, 1);
    commit(d => ({ ...d, closedMonths: [...(d.closedMonths || []).filter(m => m.monthKey !== M), record], billingMonth: next }));
    setSelectedClosed(M);
    setShowCloseConfirm(false);
    setCloseAnyway(false);
    setNotice(`${ymLabel(M)} closed. Billing month moved to ${ymLabel(next)}.`);
  }

  // ---------- billing edits ----------
  function setLineAmount(line, value) {
    if (line.manual) {
      commit(d => setIn(d, ["manualLines", M], (d.manualLines?.[M] || []).map(l => (l.id === line.id ? { ...l, amount: value } : l))));
    } else if (Math.abs(value - (line.modelAmount || 0)) < 0.005) {
      commit(d => setIn(d, ["overrides", M, line.id], undefined));
    } else {
      commit(d => setIn(d, ["overrides", M, line.id], { amount: value, at: new Date().toISOString() }));
    }
  }
  function removeLine(line) {
    if (line.manual) commit(d => setIn(d, ["manualLines", M], (d.manualLines?.[M] || []).filter(l => l.id !== line.id)));
    else commit(d => setIn(d, ["overrides", M, line.id], { removed: true, at: new Date().toISOString() }));
  }
  function restoreLine(line) {
    commit(d => setIn(d, ["overrides", M, line.id], undefined));
  }
  function removeClient(client) {
    commit(d => {
      let next = d;
      client.lines.forEach(line => {
        if (line.manual) next = setIn(next, ["manualLines", M], (next.manualLines?.[M] || []).filter(l => l.id !== line.id));
        else next = setIn(next, ["overrides", M, line.id], { removed: true, at: new Date().toISOString() });
      });
      return next;
    });
  }
  function addLine() {
    const amount = parseAmount(newLine.amount);
    if (!newLine.clientName.trim() || amount === null) return;
    const known = Object.values(bm.modelNames).find(n => clientKey(n) === clientKey(newLine.clientName));
    const line = {
      id: `manual|${makeLineId(newLine.clientName, newLine.service, newLine.department)}|${Date.now()}`,
      clientName: known || newLine.clientName.trim(),
      service: newLine.service.trim(),
      department: newLine.department.trim(),
      lead: "",
      amount: round2(amount),
    };
    commit(d => setIn(d, ["manualLines", M], [...(d.manualLines?.[M] || []), line]));
    setExpanded(prev => ({ ...prev, [clientKey(line.clientName)]: true }));
    setShowAddLine(false);
    setNewLine({ clientName: "", service: "", department: "", amount: "" });
  }
  function setLead(key, lead) {
    commit(d => ({
      ...setIn(d, ["leadOverrides", key], lead || undefined),
      approvers: lead && !(d.approvers || []).includes(lead) ? [...(d.approvers || []), lead] : d.approvers || [],
    }));
  }
  function setBillingMonth(ym) {
    setFilterLead("all");
    setFilterStatus("all");
    setExpanded({});
    commit(d => ({ ...d, billingMonth: ym }));
  }

  // ---------- data sources ----------
  function applyModel(result, source) {
    const syncedAt = new Date().toISOString();
    commit(d => ({ ...d, forecast: { lines: result.lines, totals: result.totals, syncedAt, source, sheetUrl: modelUrl } }));
    setNotice(`Financial model synced: ${result.lines.length} revenue lines across ${new Set(result.lines.map(l => clientKey(l.clientName))).size} clients.`);
  }
  async function syncModel() {
    setSyncing(true);
    setSyncError("");
    try {
      const url = modelCsvUrl(modelUrl);
      let res;
      try {
        res = await fetch(url);
      } catch {
        throw new Error("The browser could not reach Google Sheets. The sheet is probably restricted: share it as Anyone with the link can view, or use Upload file or Paste below.");
      }
      if (!res.ok) throw new Error(`Google Sheets returned ${res.status}. Check the link and sharing settings, or use Upload file or Paste below.`);
      const text = await res.text();
      if (/^\s*</.test(text)) throw new Error("Google returned a sign in page instead of data. Share the sheet as Anyone with the link can view, or use Upload file or Paste below.");
      applyModel(parseModelRows(parseCsv(text)), "Google Sheets (live sync)");
    } catch (e) {
      setSyncError(e.message);
    }
    setSyncing(false);
  }
  async function uploadModelFile(file) {
    if (!file) return;
    setSyncError("");
    try {
      const { rows, sheetName } = await readSpreadsheetFile(file, /forecasted revenue/i);
      applyModel(parseModelRows(rows.map(r => r.map(c => (c instanceof Date ? c : typeof c === "number" ? c : String(c))))), `File upload: ${file.name} (${sheetName})`);
    } catch (e) {
      setSyncError(e.message);
    }
  }
  function applyPaste() {
    setSyncError("");
    try {
      applyModel(parseModelRows(parseTsv(pasteText)), "Pasted from the Forecasted Revenue tab");
      setPasteText("");
      setShowPaste(false);
    } catch (e) {
      setSyncError(e.message);
    }
  }
  async function uploadActuals(file) {
    if (!file) return;
    setActualsError("");
    setActualsMsg("");
    try {
      const { rows } = await readSpreadsheetFile(file);
      const parsed = parseQboRows(rows);
      const months = [...new Set(parsed.lines.map(l => l.ym))].sort();
      const total = round2(parsed.lines.reduce((s, l) => s + l.amount, 0));
      const upload = { fileName: file.name, uploadedAt: new Date().toISOString(), mode: parsed.mode, months, lineCount: parsed.lines.length, total };
      commit(d => ({
        ...d,
        actuals: {
          lines: [...(d.actuals.lines || []).filter(l => !months.includes(l.ym)), ...parsed.lines],
          uploads: [...(d.actuals.uploads || []), upload].slice(-20),
        },
      }));
      setActualsMsg(`${file.name}: ${parsed.lines.length} lines, ${fmt(total)}, ${ymLabel(months[0])} to ${ymLabel(months[months.length - 1])}. Months in this file replace any earlier upload for the same months.${parsed.mode === "summary" ? " This is a summary report, so the QBO import file cannot copy items, classes or descriptions from it." : ""}`);
    } catch (e) {
      setActualsError(e.message);
    }
  }
  function clearActuals() {
    commit(d => ({ ...d, actuals: { lines: [], uploads: [] } }));
    setActualsMsg("QBO actuals cleared.");
  }
  function setMapping(qboName, value) {
    commit(d => setIn(d, ["customerMap", qboName], value || undefined));
  }
  function importLeads() {
    const rows = parseTsv(leadPaste).filter(r => r.some(c => c.trim()));
    if (!rows.length) return;
    const header = rows[0].map(c => c.trim().toLowerCase());
    const hasHeader = header.includes("lead") || header.includes("client");
    const ci = hasHeader ? Math.max(0, header.indexOf("client")) : 0;
    const li = hasHeader ? (header.indexOf("lead") >= 0 ? header.indexOf("lead") : 1) : 1;
    const pairs = (hasHeader ? rows.slice(1) : rows).map(r => [String(r[ci] || "").trim(), String(r[li] || "").trim()]).filter(([c, l]) => c && l);
    commit(d => {
      let next = d;
      pairs.forEach(([c, l]) => {
        next = setIn(next, ["leadOverrides", clientKey(c)], l);
      });
      return { ...next, approvers: [...new Set([...(next.approvers || []), ...pairs.map(p => p[1])])] };
    });
    setLeadPaste("");
    setNotice(`${pairs.length} client leads updated.`);
  }

  // ---------- export ----------
  const exportData = useMemo(() => (showExport ? buildExport(data, bm, exportOpts) : null), [showExport, data, bm, exportOpts]);
  function openExport() {
    const P0 = bm.P;
    const prevDates = (data.actuals.lines || []).filter(l => l.ym === P0 && l.date && /invoice/i.test(l.type || "invoice")).map(l => Number(l.date.slice(8, 10)));
    let day = 1;
    if (prevDates.length) {
      const counts = {};
      prevDates.forEach(x => (counts[x] = (counts[x] || 0) + 1));
      day = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    }
    const { y, m0 } = ymSplit(M);
    const date = new Date(y, m0, Math.min(day, daysInYm(M)));
    const maxNum = (data.actuals.lines || []).reduce((mx, l) => (/^\d+$/.test(l.num) ? Math.max(mx, Number(l.num)) : mx), 0);
    setExportOpts({ scope: "approved", invoiceDate: isoDate(date), autoNumber: !!data.exportSettings?.autoNumber || !maxNum, startNo: maxNum ? String(maxNum + 1) : "" });
    setShowExport(true);
  }
  function saveLineField(lineId, field, value) {
    commit(d => {
      const cur = d.invoiceFieldMemory?.[lineId] || {};
      const patch = field === "description" ? { description: value, descriptionYm: M } : { [field]: value };
      return setIn(d, ["invoiceFieldMemory", lineId], { ...cur, ...patch });
    });
  }
  function saveCustomerField(key, field, value) {
    commit(d => setIn(d, ["invoiceFieldMemory", `customer|${key}`], { ...(d.invoiceFieldMemory?.[`customer|${key}`] || {}), [field]: value }));
  }
  function markExportedAsSent() {
    if (!exportData) return;
    const stamp = new Date().toLocaleDateString("en-US");
    commit(d => {
      let next = d;
      exportData.invoices.forEach(inv => {
        const cur = next.approvalHistory?.[M]?.[inv.key] || {};
        next = setIn(next, ["approvalHistory", M, inv.key], { ...cur, status: "sent", comment: cur.comment || `Included in QBO import file ${stamp}${inv.no ? `, invoice ${inv.no}` : ""}`, amount: inv.total, at: new Date().toISOString() });
      });
      return { ...next, exportSettings: { ...next.exportSettings, autoNumber: exportOpts.autoNumber } };
    });
    setShowExport(false);
    setNotice(`${exportData.invoices.length} invoices marked as exported.`);
  }

  const closedRecords = data.closedMonths || [];
  const closedSelected = closedRecords.find(m => m.monthKey === selectedClosed) || closedRecords[closedRecords.length - 1] || null;
  const hasForecast = (data.forecast.lines || []).length > 0;
  const unmatchedCustomers = bm.qboCustomers.filter(c => !c.matched && !data.customerMap?.[c.name]);
  const mappedCustomers = bm.qboCustomers.filter(c => data.customerMap?.[c.name]);
  const modelClientOptions = Object.entries(bm.modelNames).sort((a, b) => a[1].localeCompare(b[1], "en", { sensitivity: "base" }));
  const tabs = [
    ["billing", "Billing"],
    ["approvals", "Approvals"],
    ["closed", "Closed Months"],
    ["data", "Data Sources"],
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading data...</p>
      </div>
    );
  }

  const prevLabel = `${ymLabel(P)} ${bm.prevSource === "actuals" ? "actual" : "forecast"}`;
  const totalDiff = round2(bm.total - bm.prevTotal);

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">InvoiceFlow</h1>
          <p className="text-xs text-gray-400">Fiat Growth monthly billing</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {saving && <span className="text-xs text-gray-400">Saving...</span>}
          {saveError && <span className="text-xs font-medium text-red-500">{saveError}</span>}
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
            <span className="text-xs text-gray-400">Billing month:</span>
            <select value={M} onChange={e => setBillingMonth(e.target.value)} className="text-xs font-medium text-gray-700 outline-none bg-transparent">
              {bm.monthOptions.map(ym => (
                <option key={ym} value={ym}>
                  {ymLabel(ym)}
                  {closedRecords.some(c => c.monthKey === ym) ? " (closed)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={openExport}
            disabled={!bm.rows.some(r => r.amount)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-40"
          >
            Export for QBO
          </button>
        </div>
      </div>
      <div className="bg-white border-b border-gray-100 px-6 overflow-x-auto">
        <div className="flex gap-6 min-w-max">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === id ? "border-gray-900 text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"}`}
            >
              <span className="flex items-center gap-1.5">
                {label}
                {id === "approvals" && pendingCount > 0 && <span className="bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">{pendingCount}</span>}
                {id === "data" && unmatchedCustomers.length > 0 && <span className="bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">{unmatchedCustomers.length}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {notice && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2 text-xs text-emerald-700 flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} className="text-emerald-500 hover:text-emerald-700">
              ×
            </button>
          </div>
        )}
        {!hasForecast && (
          <div className="bg-blue-50 border border-blue-100 rounded-2xl px-6 py-4 text-sm text-blue-700 flex items-center justify-between gap-3">
            <span>Sync the financial model and upload the QBO actuals to get started.</span>
            <button onClick={() => setTab("data")} className="bg-blue-700 text-white px-4 py-1.5 rounded-lg text-xs hover:bg-blue-800">
              Go to Data Sources
            </button>
          </div>
        )}

        {/* ---------------- BILLING ---------------- */}
        {tab === "billing" && (
          <>
            {bm.prevSource === "forecast" && hasForecast && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2 text-xs text-amber-700">
                No QBO actuals loaded for {ymLabel(P)}, so the comparison uses the financial model forecast for that month. Upload the QBO export in Data Sources to compare against what was actually billed.
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard label={`${ymLabel(M)} billing (forecast)`} value={fmt(bm.total)} sub={`${bm.rows.filter(r => r.amount).length} clients`} />
              <StatCard label={prevLabel} value={fmt(bm.prevTotal)} sub={`${bm.rows.filter(r => r.prevAmount).length} clients`} />
              <StatCard label="Variance" value={fmtSigned(totalDiff)} sub={fmtPct(bm.total, bm.prevTotal)} color={varColor(totalDiff)} />
              <StatCard label="Approvals" value={`${approvedCount} / ${approvalBase.length}`} sub={pendingCount ? `${pendingCount} pending` : "nothing pending"} />
            </div>

            <Card
              title={`${ymLabel(M)} vs ${ymLabel(P)} by client`}
              subtitle={isClosed ? "This month is closed, amounts are locked." : "Expand a client to edit or remove forecast lines for this month. Changes apply to this dashboard only, never to the financial model."}
              right={
                <div className="flex items-center gap-2">
                  <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none text-gray-600 bg-white">
                    <option value="az">Client A to Z</option>
                    <option value="za">Client Z to A</option>
                    <option value="amount">Billing amount</option>
                    <option value="variance">Largest variance</option>
                  </select>
                  {!isClosed && (
                    <button onClick={() => setShowAddLine(true)} className="bg-gray-900 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-gray-700">
                      + Add line
                    </button>
                  )}
                </div>
              }
            >
              {bm.rows.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-300 text-sm">No billing for {ymLabel(M)} or {ymLabel(P)}.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400 border-b border-gray-50">
                        <th className="px-6 py-3 text-left">Client</th>
                        <th className="px-4 py-3 text-left">Lead</th>
                        <th className="px-4 py-3 text-right">{prevLabel}</th>
                        <th className="px-4 py-3 text-right">{ymLabel(M)}</th>
                        <th className="px-4 py-3 text-right">Variance</th>
                        <th className="px-4 py-3 text-right">%</th>
                        <th className="px-4 py-3 text-left">Approval</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortRows(bm.rows).map(r => {
                        const open = !!expanded[r.key];
                        const edits = r.lines.filter(l => l.edited || l.removed || l.manual).length;
                        return [
                          <tr key={r.key} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-3">
                              <button onClick={() => setExpanded(prev => ({ ...prev, [r.key]: !open }))} className="text-left">
                                <span className="text-gray-300 mr-2 text-xs">{open ? "▾" : "▸"}</span>
                                <span className="font-medium text-gray-800">{r.name}</span>
                              </button>
                              {edits > 0 && <span className="ml-2 text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{edits} edited</span>}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              <EditableText value={r.lead} onSave={v => setLead(r.key, v)} placeholder="Add lead" />
                            </td>
                            <td className="px-4 py-3 text-right text-gray-500">{fmt(r.prevAmount)}</td>
                            <td className="px-4 py-3 text-right font-medium text-gray-800">{fmt(r.amount)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${varColor(r.diff)}`}>{fmtSigned(r.diff)}</td>
                            <td className={`px-4 py-3 text-right text-xs ${varColor(r.diff)}`}>{fmtPct(r.amount, r.prevAmount)}</td>
                            <td className="px-4 py-3">{r.amount ? <Badge status={statusByKey[r.key] || "pending"} /> : <span className="text-xs text-gray-300">n/a</span>}</td>
                          </tr>,
                          open && (
                            <tr key={`${r.key}-lines`} className="bg-gray-50 border-b border-gray-100">
                              <td colSpan={7} className="px-6 py-3">
                                {r.lines.length === 0 ? (
                                  <p className="text-xs text-gray-400">No forecast lines for {ymLabel(M)}.</p>
                                ) : (
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-gray-400">
                                        <th className="py-1 text-left font-normal">Service</th>
                                        <th className="py-1 text-left font-normal">Department</th>
                                        <th className="py-1 text-right font-normal">Model</th>
                                        <th className="py-1 text-right font-normal">Billing</th>
                                        <th className="py-1 text-left font-normal pl-4">Status</th>
                                        <th className="py-1"></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {r.lines.map(l => (
                                        <tr key={l.id} className="border-t border-gray-100">
                                          <td className={`py-1.5 ${l.removed ? "text-gray-300 line-through" : "text-gray-700"}`}>{l.service || "n/a"}</td>
                                          <td className="py-1.5 text-gray-500">{l.department || "n/a"}</td>
                                          <td className="py-1.5 text-right text-gray-400">{l.manual ? "n/a" : fmt(l.modelAmount)}</td>
                                          <td className="py-1.5 text-right">
                                            {l.removed ? <span className="text-gray-300">{fmt(0)}</span> : <EditableAmount value={l.amount} disabled={isClosed} onSave={v => setLineAmount(l, v)} />}
                                          </td>
                                          <td className="py-1.5 pl-4">{l.removed ? <Badge status="removed" /> : l.manual ? <Badge status="added" /> : l.edited ? <Badge status="edited" /> : <span className="text-gray-300">Model</span>}</td>
                                          <td className="py-1.5 text-right whitespace-nowrap">
                                            {!isClosed && (l.removed || l.edited) && (
                                              <button onClick={() => restoreLine(l)} className="text-blue-500 hover:underline mr-3">
                                                Reset to model
                                              </button>
                                            )}
                                            {!isClosed && !l.removed && (
                                              <button onClick={() => removeLine(l)} className="text-gray-400 hover:text-red-500">
                                                Remove
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                                {!isClosed && r.lines.some(l => !l.removed) && (
                                  <div className="mt-2 flex gap-3">
                                    <button onClick={() => removeClient(r)} className="text-xs text-red-500 hover:underline">
                                      Remove {r.name} from {ymLabel(M)}
                                    </button>
                                    <button
                                      onClick={() => {
                                        setNewLine({ clientName: r.name, service: "", department: r.departments[0] || "", amount: "" });
                                        setShowAddLine(true);
                                      }}
                                      className="text-xs text-blue-500 hover:underline"
                                    >
                                      + Add line for this client
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ),
                        ];
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="text-sm font-semibold text-gray-800">
                        <td className="px-6 py-3" colSpan={2}>
                          Total
                        </td>
                        <td className="px-4 py-3 text-right">{fmt(bm.prevTotal)}</td>
                        <td className="px-4 py-3 text-right">{fmt(bm.total)}</td>
                        <td className={`px-4 py-3 text-right ${varColor(totalDiff)}`}>{fmtSigned(totalDiff)}</td>
                        <td className={`px-4 py-3 text-right text-xs ${varColor(totalDiff)}`}>{fmtPct(bm.total, bm.prevTotal)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>

            <Card
              tone="red"
              title={`No billing in ${ymLabel(M)}`}
              subtitle={`Clients billed in ${ymLabel(P)} with nothing forecast for ${ymLabel(M)}`}
              right={<span className="text-xs text-red-500">{bm.lost.length} clients, {fmt(bm.lost.reduce((s, r) => s + r.prevAmount, 0))}</span>}
            >
              {bm.lost.length === 0 ? (
                <div className="px-6 py-6 text-center text-gray-300 text-sm">Every client billed in {ymLabel(P)} has billing in {ymLabel(M)}.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-50">
                      <th className="px-6 py-3 text-left">Client</th>
                      <th className="px-4 py-3 text-left">Lead</th>
                      <th className="px-4 py-3 text-right">{prevLabel}</th>
                      <th className="px-4 py-3 text-right">{ymLabel(M)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortRows(bm.lost).map(r => (
                      <tr key={r.key} className="border-b border-gray-50 hover:bg-red-50 transition-colors">
                        <td className="px-6 py-3 font-medium text-gray-800">{r.name}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{r.lead || "n/a"}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{fmt(r.prevAmount)}</td>
                        <td className="px-4 py-3 text-right text-gray-400">{fmt(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card
              tone="green"
              title={`New in ${ymLabel(M)}`}
              subtitle={`Clients with billing in ${ymLabel(M)} and nothing in ${ymLabel(P)}`}
              right={<span className="text-xs text-emerald-600">{bm.added.length} clients, {fmt(bm.added.reduce((s, r) => s + r.amount, 0))}</span>}
            >
              {bm.added.length === 0 ? (
                <div className="px-6 py-6 text-center text-gray-300 text-sm">No new clients this month.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-50">
                      <th className="px-6 py-3 text-left">Client</th>
                      <th className="px-4 py-3 text-left">Lead</th>
                      <th className="px-4 py-3 text-left">Services</th>
                      <th className="px-4 py-3 text-right">{prevLabel}</th>
                      <th className="px-4 py-3 text-right">{ymLabel(M)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortRows(bm.added).map(r => (
                      <tr key={r.key} className="border-b border-gray-50 hover:bg-emerald-50 transition-colors">
                        <td className="px-6 py-3 font-medium text-gray-800">{r.name}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{r.lead || "n/a"}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{[...new Set(r.lines.filter(l => !l.removed && l.amount).map(l => l.service).filter(Boolean))].join(", ")}</td>
                        <td className="px-4 py-3 text-right text-gray-400">{fmt(0)}</td>
                        <td className="px-4 py-3 text-right font-medium text-emerald-600">{fmt(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}

        {/* ---------------- APPROVALS ---------------- */}
        {tab === "approvals" && (
          <div className="space-y-4">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <h2 className="font-medium text-gray-800">Invoice Approvals, {ymLabel(M)}</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {ymLabel(M)} billing vs {prevLabel}
                </p>
              </div>
              <div className="flex flex-col gap-2 items-end">
                <div className="flex gap-2 flex-wrap justify-end items-center">
                  <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-xs outline-none text-gray-600 bg-white">
                    <option value="az">Client A to Z</option>
                    <option value="za">Client Z to A</option>
                    <option value="amount">Billing amount</option>
                    <option value="variance">Largest variance</option>
                  </select>
                  <button onClick={() => setShowClearConfirm(true)} className="px-3 py-2 rounded-lg text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50">
                    Clear approvals for this month
                  </button>
                  {isClosed ? (
                    <button onClick={reopenMonth} className="px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">
                      🔓 Reopen month
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setCloseAnyway(false);
                        setShowCloseConfirm(true);
                      }}
                      disabled={!canClose}
                      title={!approvalBase.length ? `No billing for ${ymLabel(M)}` : `Close ${ymLabel(M)} and move to ${ymLabel(ymAdd(M, 1))}`}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Close Month →
                    </button>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap justify-end">
                  {approvalLeads.map(lead => (
                    <button
                      key={lead}
                      onClick={() => setFilterLead(lead)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterLead === lead ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                    >
                      {lead === "all" ? "All leads" : lead}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 flex-wrap justify-end">
                  {approvalStatuses.map(status => {
                    const colors = { all: "bg-gray-900 text-white", pending: "bg-amber-500 text-white", approved: "bg-blue-600 text-white", "see notes": "bg-orange-500 text-white", rejected: "bg-red-500 text-white", sent: "bg-purple-600 text-white" };
                    return (
                      <button
                        key={status}
                        onClick={() => setFilterStatus(status)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${filterStatus === status ? colors[status] : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                      >
                        {status === "all" ? "All statuses" : status === "sent" ? "Exported" : status}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-full">{filteredApprovals.filter(r => r.status === "pending").length} pending</span>
                  <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full">{filteredApprovals.filter(r => r.status === "approved").length} approved</span>
                  <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full">{fmt(filteredApprovals.reduce((s, r) => s + r.amount, 0))}</span>
                </div>
              </div>
            </div>
            {isClosed && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500">
                🔒 <strong>{ymLabel(M)}</strong> is closed. Approvals are locked. Use Reopen month to make changes.
              </div>
            )}
            {!isClosed && blockers.length > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-800 flex items-center justify-between gap-3 flex-wrap">
                <span>
                  {blockers.length} invoice{blockers.length !== 1 ? "s still need" : " still needs"} a decision before closing {ymLabel(M)}: {blockers.filter(r => r.status === "pending").length} pending, {blockers.filter(r => r.status === "see notes").length} see notes. Rejected invoices do not hold the close.
                </span>
                <button
                  onClick={() => {
                    setFilterLead("all");
                    setFilterStatus(blockers.some(r => r.status === "pending") ? "pending" : "see notes");
                  }}
                  className="text-amber-700 underline whitespace-nowrap"
                >
                  Show them
                </button>
              </div>
            )}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
              {filteredApprovals.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-300 text-sm">{approvalBase.length === 0 ? `No billing for ${ymLabel(M)}` : "No invoices for this filter"}</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-50">
                      <th className="px-6 py-3 text-left">Client</th>
                      <th className="px-4 py-3 text-left">Lead</th>
                      <th className="px-4 py-3 text-right">{prevLabel}</th>
                      <th className="px-4 py-3 text-right">{ymLabel(M)}</th>
                      <th className="px-4 py-3 text-right">Change</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">Comment</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApprovals.map(r => (
                      <tr key={r.key} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3">
                          <div className="font-medium text-gray-800">{r.name}</div>
                          <button onClick={() => setShowLines({ name: r.name, month: ymLabel(M), amount: r.amount, lines: r.lines.filter(l => !l.removed && l.amount) })} className="text-xs text-blue-500 hover:underline">
                            View {r.lines.filter(l => !l.removed && l.amount).length} line{r.lines.filter(l => !l.removed && l.amount).length !== 1 ? "s" : ""}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-xs">{isClosed ? <span className="text-gray-500">{r.lead || "n/a"}</span> : <EditableText value={r.lead} onSave={v => setLead(r.key, v)} placeholder="Add lead" />}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{fmt(r.prevAmount)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-800">{fmt(r.amount)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${varColor(r.diff)}`}>{fmtSigned(r.diff)}</td>
                        <td className="px-4 py-3">
                          <Badge status={r.status} />
                          {r.changedSinceApproval && <div className="text-xs text-amber-600 mt-1">Amount changed since approval ({fmt(r.approvedAmount)})</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs italic max-w-xs">{r.comment || ""}</td>
                        <td className="px-4 py-3 text-right">
                          {isClosed ? (
                            <span className="text-xs text-gray-300">🔒 locked</span>
                          ) : (
                            <div className="flex gap-2 justify-end">
                              {r.status === "pending" && (
                                <button onClick={() => openReview(r)} className="text-xs bg-gray-900 text-white px-3 py-1 rounded-lg hover:bg-gray-700">
                                  Review
                                </button>
                              )}
                              {r.status === "see notes" && (
                                <button onClick={() => openReview(r)} className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg hover:bg-orange-600">
                                  See Notes
                                </button>
                              )}
                              {(r.status === "approved" || r.status === "sent") && (
                                <button onClick={() => openReview(r)} className="text-xs text-gray-400 border border-gray-200 px-3 py-1 rounded-lg hover:bg-gray-50">
                                  {r.changedSinceApproval ? "Re review" : "Edit"}
                                </button>
                              )}
                              {r.status === "rejected" && (
                                <button onClick={() => saveApproval(r.key, { status: "pending", comment: "" })} className="text-xs text-amber-600 border border-amber-200 px-3 py-1 rounded-lg hover:bg-amber-50">
                                  Resubmit
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ---------------- CLOSED MONTHS ---------------- */}
        {tab === "closed" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="font-medium text-gray-800">Closed Months</h2>
                <p className="text-xs text-gray-400 mt-0.5">What was approved and billed when each month was closed.</p>
              </div>
              {closedRecords.length > 0 && (
                <select value={closedSelected?.monthKey || ""} onChange={e => setSelectedClosed(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none text-gray-600 bg-white">
                  {closedRecords.map(m => (
                    <option key={m.monthKey} value={m.monthKey}>
                      {m.monthLabel || ymLabel(m.monthKey)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {!closedSelected ? (
              <div className="bg-white rounded-2xl border border-gray-100 px-6 py-10 text-center text-gray-300 text-sm">No closed months yet. Once every invoice is approved, close the month from Approvals.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <StatCard label="Closed month" value={closedSelected.monthLabel || ymLabel(closedSelected.monthKey)} sub={closedSelected.closedAt ? new Date(closedSelected.closedAt).toLocaleDateString("en-US") : "saved"} />
                  <StatCard label="Billed total" value={fmt(closedSelected.total)} sub={`${closedSelected.invoiceCount || 0} invoices`} />
                  <StatCard label="Approved" value={closedSelected.approvedCount || 0} sub="approved, not exported" />
                  <StatCard label="Exported" value={closedSelected.sentCount || 0} sub="included in a QBO import file" />
                </div>
                <Card title="Billed invoices" right={<span className="text-xs text-gray-400">{closedSelected.monthLabel}</span>}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400 border-b border-gray-50">
                        <th className="px-6 py-3 text-left">Client</th>
                        <th className="px-4 py-3 text-left">Lead</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                        <th className="px-4 py-3 text-left">Status</th>
                        <th className="px-4 py-3 text-left">Approver</th>
                        <th className="px-4 py-3 text-left">Comment</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...(closedSelected.invoices || [])]
                        .sort((a, b) => String(a.clientName).localeCompare(String(b.clientName), "en", { sensitivity: "base" }))
                        .map(inv => (
                          <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-6 py-3 font-medium text-gray-800">{inv.clientName}</td>
                            <td className="px-4 py-3 text-xs text-gray-500">{inv.lead || "n/a"}</td>
                            <td className="px-4 py-3 text-right font-medium text-gray-800">{fmt(inv.amount)}</td>
                            <td className="px-4 py-3">
                              <Badge status={inv.status || "pending"} />
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">{inv.approver || "n/a"}</td>
                            <td className="px-4 py-3 text-gray-400 text-xs italic">{inv.comment || ""}</td>
                            <td className="px-4 py-3 text-right">
                              {!!inv.lines?.length && (
                                <button onClick={() => setShowLines({ name: inv.clientName, month: closedSelected.monthLabel, amount: inv.amount, lines: inv.lines })} className="text-xs text-blue-500 hover:underline">
                                  View {inv.lines.length} line{inv.lines.length > 1 ? "s" : ""}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </Card>
              </>
            )}
          </div>
        )}

        {/* ---------------- DATA SOURCES ---------------- */}
        {tab === "data" && (
          <div className="space-y-6">
            <Card
              title="Financial model, Forecasted Revenue tab"
              subtitle={data.forecast.syncedAt ? `Last synced ${new Date(data.forecast.syncedAt).toLocaleString("en-US")} · ${data.forecast.source}` : data.forecast.source || "Not synced yet"}
              right={
                hasForecast && (
                  <span className="text-xs text-gray-400">
                    {data.forecast.lines.length} lines · {new Set(data.forecast.lines.map(l => clientKey(l.clientName))).size} clients
                  </span>
                )
              }
            >
              <div className="px-6 py-4 space-y-3">
                <div className="flex gap-2 flex-wrap">
                  <input value={modelUrl} onChange={e => setModelUrl(e.target.value)} className="flex-1 min-w-[280px] border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-gray-400 font-mono" />
                  <button onClick={syncModel} disabled={syncing} className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40">
                    {syncing ? "Syncing..." : "Sync now"}
                  </button>
                </div>
                <div className="flex gap-2 flex-wrap items-center text-xs">
                  <label className="border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 cursor-pointer">
                    Upload file (xlsx or csv)
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={e => {
                        uploadModelFile(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button onClick={() => setShowPaste(v => !v)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50">
                    {showPaste ? "Hide paste" : "Paste from the sheet"}
                  </button>
                  <span className="text-gray-400">Live sync needs the spreadsheet shared as Anyone with the link can view. Otherwise download the tab (File, Download, CSV) and upload it, or paste it.</span>
                </div>
                {showPaste && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">In the Forecasted Revenue tab, select from the header row (Client Name, Service, Department, months) down to the last client, copy and paste here.</p>
                    <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={6} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-gray-400" />
                    <button onClick={applyPaste} disabled={!pasteText.trim()} className="bg-gray-900 text-white text-xs px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40">
                      Load pasted data
                    </button>
                  </div>
                )}
                {syncError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{syncError}</p>}
                {hasForecast && data.forecast.totals && data.forecast.totals[M] !== undefined && (
                  <p className={`text-xs ${Math.abs(data.forecast.totals[M] - bm.modelTotalForM) < 1 ? "text-emerald-600" : "text-amber-600"}`}>
                    Tie out for {ymLabel(M)}: client lines {fmt(bm.modelTotalForM)} vs model Totals row {fmt(data.forecast.totals[M])}
                    {Math.abs(data.forecast.totals[M] - bm.modelTotalForM) < 1 ? ", ties." : `, difference ${fmt(data.forecast.totals[M] - bm.modelTotalForM)}.`}
                  </p>
                )}
                <p className="text-xs text-gray-400">Syncing replaces the model lines only. Your edits, removed lines, added lines, leads and approvals are kept.</p>
              </div>
            </Card>

            <Card
              title="QBO actuals"
              subtitle="Upload the QBO export of past invoices. Sales by Customer Detail (or Transaction List by Customer) with Date, Num, Customer, Product/Service, Memo/Description, Class, Terms, Due date and Amount works best, since it also feeds the import file."
              right={
                (data.actuals.lines || []).length > 0 && (
                  <button onClick={clearActuals} className="text-xs text-red-500 hover:underline">
                    Clear actuals
                  </button>
                )
              }
            >
              <div className="px-6 py-4 space-y-3">
                <label className="block border-2 border-dashed border-gray-200 rounded-2xl p-6 text-center cursor-pointer hover:border-emerald-300 hover:bg-emerald-50 transition-colors">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={e => {
                      uploadActuals(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <p className="text-sm font-medium text-gray-600">Click to attach the QBO Excel export</p>
                  <p className="text-xs text-gray-400 mt-1">Months in a new file replace the same months from earlier uploads</p>
                </label>
                {actualsMsg && <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{actualsMsg}</p>}
                {actualsError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{actualsError}</p>}
                {bm.actualMonths.length > 0 && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-50">
                        <th className="py-2 text-left font-normal">Month</th>
                        <th className="py-2 text-right font-normal">Customers</th>
                        <th className="py-2 text-right font-normal">Invoices</th>
                        <th className="py-2 text-right font-normal">Total billed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...bm.actualMonths].reverse().map(ym => {
                        const ls = data.actuals.lines.filter(l => l.ym === ym);
                        return (
                          <tr key={ym} className="border-b border-gray-50">
                            <td className="py-1.5 text-gray-700">{ymLabel(ym)}</td>
                            <td className="py-1.5 text-right text-gray-500">{Object.keys(bm.actualsByYm[ym] || {}).length}</td>
                            <td className="py-1.5 text-right text-gray-500">{new Set(ls.map(l => l.num || `${l.customer}|${l.date}`)).size}</td>
                            <td className="py-1.5 text-right font-medium text-gray-800">{fmt(ls.reduce((s, l) => s + l.amount, 0))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            <Card
              title="QBO customer matching"
              subtitle="QBO customers are matched to model clients by name, ignoring case, punctuation and LLC or Inc. Map the ones that did not match so actuals land on the right client."
              right={
                mappedCustomers.length > 0 && (
                  <button onClick={() => setShowAllMappings(v => !v)} className="text-xs text-blue-500 hover:underline">
                    {showAllMappings ? "Hide manual mappings" : `Show ${mappedCustomers.length} manual mappings`}
                  </button>
                )
              }
            >
              {bm.qboCustomers.length === 0 ? (
                <div className="px-6 py-6 text-center text-gray-300 text-sm">Upload QBO actuals to see customer matching.</div>
              ) : unmatchedCustomers.length === 0 && !showAllMappings ? (
                <div className="px-6 py-6 text-center text-emerald-600 text-sm">All {bm.qboCustomers.length} QBO customers are matched.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-50">
                      <th className="px-6 py-3 text-left">QBO customer</th>
                      <th className="px-4 py-3 text-right">Total in actuals</th>
                      <th className="px-4 py-3 text-left">Model client</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...unmatchedCustomers, ...(showAllMappings ? mappedCustomers : [])].map(c => (
                      <tr key={c.name} className="border-b border-gray-50">
                        <td className="px-6 py-2 text-gray-800">{c.name}</td>
                        <td className="px-4 py-2 text-right text-gray-500">{fmt(c.total)}</td>
                        <td className="px-4 py-2">
                          <select value={data.customerMap?.[c.name] || ""} onChange={e => setMapping(c.name, e.target.value)} className="w-full max-w-sm border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none bg-white">
                            <option value="">Not in the model, keep as its own client</option>
                            {modelClientOptions.map(([key, name]) => (
                              <option key={key} value={key}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Leads" subtitle="Leads drive the approval filters. Edit them inline in Billing or Approvals, or paste a Client and Lead table here (with headers).">
              <div className="px-6 py-4 space-y-2">
                <textarea value={leadPaste} onChange={e => setLeadPaste(e.target.value)} rows={4} placeholder={"Client\tLead\nAcme Corp\tSarah Johnson"} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-gray-400" />
                <button onClick={importLeads} disabled={!leadPaste.trim()} className="bg-gray-900 text-white text-xs px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40">
                  Update leads
                </button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* ---------------- MODALS ---------------- */}
      {showAddLine && (
        <Modal title={`Add billing line, ${ymLabel(M)}`} onClose={() => setShowAddLine(false)}>
          <div className="space-y-3">
            <p className="text-xs text-gray-500">The line is added to this dashboard for {ymLabel(M)} only. It does not change the financial model.</p>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Client *</label>
              <input
                list="client-options"
                value={newLine.clientName}
                onChange={e => setNewLine(prev => ({ ...prev, clientName: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
              />
              <datalist id="client-options">
                {modelClientOptions.map(([key, name]) => (
                  <option key={key} value={name} />
                ))}
              </datalist>
            </div>
            {[
              ["Service", "service"],
              ["Department", "department"],
            ].map(([label, key]) => (
              <div key={key}>
                <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                <input value={newLine[key]} onChange={e => setNewLine(prev => ({ ...prev, [key]: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400" />
              </div>
            ))}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Amount for {ymLabel(M)} *</label>
              <input value={newLine.amount} onChange={e => setNewLine(prev => ({ ...prev, amount: e.target.value }))} placeholder="0.00" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowAddLine(false)} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={addLine} disabled={!newLine.clientName.trim() || parseAmount(newLine.amount) === null} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">
                Add line
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showApprove && (
        <Modal title={`Review invoice, ${showApprove.name}`} onClose={() => setShowApprove(null)}>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Lead</span>
                <span>{showApprove.lead || "n/a"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{prevLabel}</span>
                <span>{fmt(showApprove.prevAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{ymLabel(M)}</span>
                <span className="font-semibold text-gray-900">{fmt(showApprove.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Variance</span>
                <span className={varColor(showApprove.diff)}>
                  {fmtSigned(showApprove.diff)} ({fmtPct(showApprove.amount, showApprove.prevAmount)})
                </span>
              </div>
              <div className="border-t border-gray-200 pt-2 space-y-1">
                {showApprove.lines
                  .filter(l => !l.removed && l.amount)
                  .map(l => (
                    <div key={l.id} className="flex justify-between text-xs text-gray-500">
                      <span>
                        {l.service || "Line"}
                        {l.department ? `, ${l.department}` : ""}
                      </span>
                      <span>{fmt(l.amount)}</span>
                    </div>
                  ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Approver</label>
              <select value={approveApprover} onChange={e => setApproveApprover(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none">
                {[...new Set([approveApprover, ...approvers].filter(Boolean))].map(a => (
                  <option key={a}>{a}</option>
                ))}
                {!approveApprover && !approvers.length && <option value="">n/a</option>}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Comment (optional)</label>
              <textarea value={approveComment} onChange={e => setApproveComment(e.target.value)} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none resize-none focus:border-gray-400" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => decide("rejected")} className="flex-1 border border-red-200 text-red-600 rounded-lg py-2 text-sm hover:bg-red-50">
                Reject
              </button>
              <button onClick={() => decide("see notes")} className="flex-1 border border-orange-200 text-orange-600 rounded-lg py-2 text-sm hover:bg-orange-50">
                See Notes
              </button>
              <button onClick={() => decide("approved")} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700">
                Approve
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showLines && (
        <Modal title={`Invoice lines, ${showLines.name}`} onClose={() => setShowLines(null)} size="wide">
          <div className="space-y-3">
            <p className="text-xs text-gray-400">Month: {showLines.month}</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="py-2 text-left">Service</th>
                  <th className="py-2 text-left">Department</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {showLines.lines.map((l, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-700">
                      {l.service || "n/a"}
                      {l.manual && <span className="ml-2 text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">added</span>}
                      {l.edited && <span className="ml-2 text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">edited</span>}
                    </td>
                    <td className="py-2 text-xs text-gray-500">{l.department || "n/a"}</td>
                    <td className="py-2 text-right font-medium text-gray-800">{fmt(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="pt-3 text-sm font-medium text-gray-600">
                    Total
                  </td>
                  <td className="pt-3 text-right font-semibold text-gray-900">{fmt(showLines.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Modal>
      )}

      {showCloseConfirm && (
        <Modal title="Close Month" onClose={() => setShowCloseConfirm(false)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Close <strong>{ymLabel(M)}</strong>? Approvals will be locked and a snapshot of the billed invoices will be saved. The billing month will move to <strong>{ymLabel(ymAdd(M, 1))}</strong>. You can reopen it later if needed.
            </p>
            {blockers.length > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-2">
                <p className="text-xs font-medium text-amber-800">{blockers.length} invoice{blockers.length !== 1 ? "s have" : " has"} no decision yet:</p>
                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  {blockers.map(r => (
                    <p key={r.key} className="text-xs text-amber-800">
                      {r.name}, {fmt(r.amount)}, {r.status}
                      {r.lead ? `, ${r.lead}` : ""}
                    </p>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-amber-900 pt-1">
                  <input type="checkbox" checked={closeAnyway} onChange={e => setCloseAnyway(e.target.checked)} />
                  Close anyway and save them with their current status
                </label>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowCloseConfirm(false)} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={closeMonth} disabled={blockers.length > 0 && !closeAnyway} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">
                Close Month
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showClearConfirm && (
        <Modal title={`Clear ${ymLabel(M)} approvals`} onClose={() => setShowClearConfirm(false)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              This deletes every approval, comment and export mark for <strong>{ymLabel(M)}</strong>
              {isClosed ? ", and removes the month from Closed Months" : ""}. Billing amounts and edits are not affected. This cannot be undone.
            </p>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowClearConfirm(false)} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={resetApprovals} className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm hover:bg-red-700">
                Delete {ymLabel(M)} approvals
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showExport && exportData && (
        <Modal title={`QBO invoice import, ${ymLabel(M)}`} onClose={() => setShowExport(false)} size="xl">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Include</label>
                <select value={exportOpts.scope} onChange={e => setExportOpts(o => ({ ...o, scope: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                  <option value="approved">Approved only</option>
                  <option value="approved_sent">Approved and already exported</option>
                  <option value="all">All clients with billing</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Invoice date</label>
                <input type="date" value={exportOpts.invoiceDate} onChange={e => setExportOpts(o => ({ ...o, invoiceDate: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Invoice numbers</label>
                <select value={exportOpts.autoNumber ? "auto" : "seq"} onChange={e => setExportOpts(o => ({ ...o, autoNumber: e.target.value === "auto" }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                  <option value="seq">Continue the QBO sequence</option>
                  <option value="auto">Blank, QBO auto numbers</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">First invoice number</label>
                <input
                  value={exportOpts.startNo}
                  disabled={exportOpts.autoNumber}
                  onChange={e => setExportOpts(o => ({ ...o, startNo: e.target.value.replace(/[^0-9]/g, "") }))}
                  placeholder={exportData.maxNum ? String(exportData.maxNum + 1) : "1001"}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none disabled:bg-gray-50 disabled:text-gray-300"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Invoices" value={exportData.invoices.length} sub={`${exportData.invoices.reduce((s, i) => s + i.lines.length, 0)} lines`} />
              <StatCard label="Total" value={fmt(exportData.total)} sub={`${ymLabel(M)} billing ${fmt(bm.total)}`} />
              <StatCard label="Exceptions" value={exportData.actionable} sub={`review before importing${exportData.exceptions.length > exportData.actionable ? `, plus ${exportData.exceptions.length - exportData.actionable} not included` : ""}`} color={exportData.actionable ? "text-amber-600" : "text-gray-900"} />
            </div>

            {exportData.exceptions.length > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 max-h-40 overflow-y-auto">
                {exportData.exceptions.map((e, i) => (
                  <p key={i} className="text-xs text-amber-800">
                    <strong>{e.type}:</strong> {e.customer}, {e.detail}
                  </p>
                ))}
              </div>
            )}

            <p className="text-xs text-gray-400">
              Product/Service, Class, Terms and Description come from each customer's last invoice in the QBO actuals, with month references rolled forward. Edit any cell and the change is remembered for next month. Blank cells in amber need a value before importing.
            </p>
            <div className="border border-gray-100 rounded-xl overflow-x-auto max-h-[45vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="px-3 py-2 text-left">No.</th>
                    <th className="px-3 py-2 text-left">QBO customer</th>
                    <th className="px-3 py-2 text-left">Terms</th>
                    <th className="px-3 py-2 text-left">Product/Service</th>
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="px-3 py-2 text-left">Class</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {exportData.invoices.map(inv =>
                    inv.lines.map((l, idx) => (
                      <tr key={`${inv.key}-${l.lineId}`} className={`border-b border-gray-50 align-top ${idx === 0 ? "border-t border-gray-100" : ""}`}>
                        <td className="px-3 py-1.5 text-gray-500">{idx === 0 ? inv.no || "auto" : ""}</td>
                        <td className="px-3 py-1.5">
                          {idx === 0 && (
                            <div>
                              <EditableText value={inv.customer} onSave={v => saveCustomerField(inv.key, "customer", v)} className="w-56" />
                              {inv.newCustomer && <div className="text-amber-600 mt-0.5">New in QBO, confirm the name</div>}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5">{idx === 0 && <EditableText value={inv.terms} onSave={v => saveCustomerField(inv.key, "terms", v)} placeholder="Customer default" />}</td>
                        <td className={`px-3 py-1.5 ${l.item ? "" : "bg-amber-50"}`}>
                          <EditableText value={l.item} onSave={v => saveLineField(l.lineId, "item", v)} placeholder={l.service ? `Set item for ${l.service}` : "Set item"} className="w-48" />
                        </td>
                        <td className="px-3 py-1.5 max-w-xs">
                          <EditableText value={l.description} onSave={v => saveLineField(l.lineId, "description", v)} className="w-72" />
                        </td>
                        <td className={`px-3 py-1.5 ${l.class || !exportData.usesClass ? "" : "bg-amber-50"}`}>
                          <EditableText value={l.class} onSave={v => saveLineField(l.lineId, "class", v)} placeholder={l.department ? `Set class (${l.department})` : "Set class"} className="w-40" />
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium text-gray-800 whitespace-nowrap">{fmt(l.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {exportData.invoices.length === 0 && <div className="px-6 py-8 text-center text-gray-300 text-sm">No invoices match this filter. Approve invoices first or change Include.</div>}
            </div>

            <div className="flex gap-3 flex-wrap justify-end">
              <button onClick={() => setShowExport(false)} className="border border-gray-200 text-gray-600 rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
                Close
              </button>
              <button onClick={() => exportReviewWorkbook(exportData, bm, data)} className="border border-gray-200 text-gray-700 rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
                Download review workbook (xlsx)
              </button>
              <button onClick={() => exportCsv(exportData, M)} disabled={!exportData.invoices.length} className="bg-emerald-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-emerald-700 disabled:opacity-40">
                Download QBO import CSV
              </button>
              <button onClick={markExportedAsSent} disabled={!exportData.invoices.length || isClosed} className="bg-purple-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-purple-700 disabled:opacity-40">
                Mark these as exported
              </button>
            </div>
            <p className="text-xs text-gray-400 text-right">QBO's native invoice import may not map the Class column. SaaSAnt or Transaction Pro do.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

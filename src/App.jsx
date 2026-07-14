
import { useEffect, useMemo, useRef, useState } from "react";

const SUPABASE_URL = "https://hpycqegogkqsodvykqfj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhweWNxZWdvZ2txc29kdnlrcWZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTUxMTcsImV4cCI6MjA4OTUzMTExN30.Rb5r_9gsNNVIl0e9dqYraYJdDayvunqEMfQ_I8FmfKI";
const LOCAL_STORAGE_KEY = "invoiceflow_data_backup";

async function loadFromSupabase() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/invoiceflow_data?id=eq.main&select=data`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase load failed: ${res.status}`);
  const rows = await res.json();
  return rows?.[0]?.data || null;
}

async function saveToSupabase(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/invoiceflow_data?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ id: "main", data, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase save failed: ${res.status} ${await res.text()}`);
}

function loadLocalBackup() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveLocalBackup(data) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
}

function fmt(n) {
  return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

const DEPT_DEFAULT_LEADS = { "fiat finance": "Kaley", uncovered: "Nick" };

function getDefaultLead(d) {
  return DEPT_DEFAULT_LEADS[d?.toLowerCase().trim()] || "";
}

function makeClientKey(name) {
  return String(name || "").trim().toLowerCase();
}

function Badge({ status }) {
  const s = {
    active: "bg-emerald-50 text-emerald-700",
    pending: "bg-amber-50 text-amber-700",
    approved: "bg-blue-50 text-blue-700",
    sent: "bg-purple-50 text-purple-700",
    rejected: "bg-red-50 text-red-700",
    archived: "bg-gray-100 text-gray-500",
    "see notes": "bg-orange-50 text-orange-600",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s[status] || "bg-gray-100 text-gray-500"}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-20 p-4">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? "max-w-3xl" : "max-w-md"} p-6 max-h-[90vh] overflow-y-auto`}>
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

function EditableCell({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const ref = useRef(null);

  function start() {
    setVal(String(value || 0));
    setEditing(true);
    setTimeout(() => ref.current?.select(), 30);
  }

  function save() {
    const n = parseFloat(String(val).replace(/[$,]/g, "")) || 0;
    onSave(n);
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
        className="w-24 border border-blue-300 rounded px-2 py-0.5 text-right text-xs outline-none bg-blue-50"
      />
    );
  }

  return (
    <span
      onClick={start}
      title="Click to edit"
      className="cursor-pointer hover:bg-blue-50 hover:text-blue-700 px-1 py-0.5 rounded transition-colors font-medium text-gray-800"
    >
      {fmt(value)}
    </span>
  );
}

function NewProjectedClients({ clients, currentMonthLabel, lastMonthLabel }) {
  const newProjected = clients.filter(c => c.amount > 0 && c.lastAmount === 0);
  if (!newProjected.length) return null;

  return (
    <div className="bg-white rounded-2xl border border-emerald-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-emerald-50 flex items-center justify-between">
        <h2 className="font-medium text-emerald-700">New in projected month</h2>
        <span className="text-xs text-emerald-500">
          {newProjected.length} client{newProjected.length > 1 ? "s" : ""} have projected billing but no previous-month billing
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-400 border-b border-gray-50">
            <th className="px-6 py-3 text-left">Client</th>
            <th className="px-6 py-3 text-left">Lead</th>
            <th className="px-6 py-3 text-left">Departments</th>
            <th className="px-6 py-3 text-right">{lastMonthLabel || "Previous Month"}</th>
            <th className="px-6 py-3 text-right">{currentMonthLabel || "Projected Month"}</th>
          </tr>
        </thead>
        <tbody>
          {newProjected.map(c => {
            const depts = [...new Set(c.lines.map(l => l.department))].filter(Boolean);
            return (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-emerald-50 transition-colors">
                <td className="px-6 py-3 font-medium text-gray-800">{c.name}</td>
                <td className="px-6 py-3 text-xs text-gray-500">{c.lead || "—"}</td>
                <td className="px-6 py-3">
                  <div className="flex flex-wrap gap-1">
                    {depts.map(d => (
                      <span key={d} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">
                        {d}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-3 text-right text-gray-500">$0.00</td>
                <td className="px-6 py-3 text-right font-medium text-emerald-600">{fmt(c.amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function parseColDate(header) {
  const h = String(header);
  let m = h.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, 1);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = h.match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (m) {
    const mo = months.indexOf(m[1].toLowerCase());
    if (mo >= 0) return new Date(Number(m[2]), mo, 1);
  }
  return null;
}

function formatMonthLabel(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function labelFromKey(key) {
  if (!key) return "";
  const d = parseColDate(key);
  return d ? formatMonthLabel(d) : key;
}

function parsePaste(text) {
  return text
    .trim()
    .split("\n")
    .map(r => r.split("\t").map(c => c.trim()));
}

function rowsToObjects(rows) {
  if (rows.length < 2) return { objects: [], headers: [] };
  const headers = rows[0];
  const objects = rows
    .slice(1)
    .filter(r => r.some(c => c))
    .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])));
  return { objects, headers };
}

function parseAmount(val) {
  if (!val) return 0;
  return parseFloat(String(val).replace(/[$,\s]/g, "")) || 0;
}

function getMonthCols(headers) {
  return headers
    .map((h, i) => ({ h, i, d: parseColDate(h) }))
    .filter(x => x.d)
    .sort((a, b) => a.d - b.d);
}

function normalizeMonthCols(savedCols, savedClients = []) {
  const fromSaved = (savedCols || [])
    .map((col, idx) => ({ h: col.h, i: col.i ?? idx, d: parseColDate(col.h) }))
    .filter(col => col.h && col.d);

  if (fromSaved.length) return fromSaved.sort((a, b) => a.d - b.d);

  const keys = new Set();
  (savedClients || []).forEach(client => {
    (client.lines || []).forEach(line => {
      Object.keys(line.amounts || {}).forEach(key => {
        if (parseColDate(key)) keys.add(key);
      });
    });
  });

  return [...keys]
    .map((h, i) => ({ h, i, d: parseColDate(h) }))
    .filter(col => col.d)
    .sort((a, b) => a.d - b.d);
}

function getMonthContext(cols, key) {
  if (!cols.length) {
    return {
      curKey: "",
      nextKey: "",
      prevKey: "",
      curLabel: "",
      nextLabel: "",
      prevLabel: "",
    };
  }

  const fallback = cols[cols.length - 2] || cols[cols.length - 1];
  const current = (key && cols.find(c => c.h === key)) || fallback;
  const idx = cols.findIndex(c => c.h === current.h);
  const prev = idx > 0 ? cols[idx - 1] : null;
  const next = idx < cols.length - 1 ? cols[idx + 1] : null;

  return {
    curKey: current?.h || "",
    nextKey: next?.h || "",
    prevKey: prev?.h || "",
    curLabel: current ? formatMonthLabel(current.d) : "",
    nextLabel: next ? formatMonthLabel(next.d) : "",
    prevLabel: prev ? formatMonthLabel(prev.d) : "",
  };
}

function sumForMonth(lines, monthKey) {
  if (!monthKey) return 0;
  return (lines || []).reduce((sum, line) => sum + (line.amounts?.[monthKey] || 0), 0);
}

function enrichClientForContext(client, ctx) {
  const lines = client.lines || [];
  return {
    ...client,
    amount: sumForMonth(lines, ctx.curKey),
    lastAmount: sumForMonth(lines, ctx.prevKey),
    nextAmount: sumForMonth(lines, ctx.nextKey),
    multiDept: new Set(lines.map(l => l.department).filter(Boolean)).size > 1,
  };
}

function cloneLinesWithAdjustedTotal(lines, monthKey, newTotal) {
  const nextLines = (lines || []).map(line => ({
    ...line,
    amounts: { ...(line.amounts || {}) },
  }));

  if (!monthKey || !nextLines.length) return nextLines;

  const currentTotal = nextLines.reduce((sum, line) => sum + (line.amounts?.[monthKey] || 0), 0);
  const delta = newTotal - currentTotal;

  if (nextLines.length === 1) {
    nextLines[0].amounts[monthKey] = newTotal;
    return nextLines;
  }

  let targetIdx = 0;
  let biggest = -Infinity;
  nextLines.forEach((line, idx) => {
    const val = line.amounts?.[monthKey] || 0;
    if (val > biggest) {
      biggest = val;
      targetIdx = idx;
    }
  });

  nextLines[targetIdx].amounts[monthKey] = (nextLines[targetIdx].amounts?.[monthKey] || 0) + delta;
  return nextLines;
}

function buildInvoiceRecord(client, ctx, approvalHistory, defaultApprover) {
  const approvalMonthKey = ctx.curKey;
  const stored = approvalHistory?.[approvalMonthKey]?.[makeClientKey(client.name)] || {};
  const lines = client.lines || [];

  return {
    id: `${approvalMonthKey}-${client.id}`,
    clientId: client.id,
    clientName: client.name,
    amount: sumForMonth(lines, ctx.curKey),
    lastAmount: sumForMonth(lines, ctx.prevKey),
    nextAmount: sumForMonth(lines, ctx.nextKey),
    approver: stored.approver || client.approver || defaultApprover || "",
    lead: client.lead || "",
    status: stored.status || "pending",
    comment: stored.comment || "",
    month: ctx.curLabel,
    monthCol: ctx.curKey,
    previousMonthCol: ctx.prevKey,
    nextMonthCol: ctx.nextKey,
    approvalMonthKey,
    lines,
    multiDept: new Set(lines.map(l => l.department).filter(Boolean)).size > 1,
  };
}

function migrateApprovalHistory(legacyInvoices) {
  const history = {};
  (legacyInvoices || []).forEach(inv => {
    const monthKey = inv.monthCol || "";
    const clientKey = makeClientKey(inv.clientName);
    if (!monthKey || !clientKey) return;
    history[monthKey] = history[monthKey] || {};
    history[monthKey][clientKey] = {
      status: inv.status || "pending",
      comment: inv.comment || "",
      approver: inv.approver || "",
    };
  });
  return history;
}

function normalizeClosedMonths(value) {
  return (value || []).map(item => (typeof item === "string" ? { monthKey: item, monthLabel: labelFromKey(item), closedAt: "", invoices: [] } : item));
}

function buildClosedMonthRecord(monthKey, ctx, invoices) {
  const snapshotInvoices = (invoices || [])
    .filter(inv => inv.amount > 0)
    .map(inv => ({
      id: inv.id,
      clientId: inv.clientId,
      clientName: inv.clientName,
      lead: inv.lead,
      approver: inv.approver,
      status: inv.status,
      comment: inv.comment,
      amount: inv.amount,
      lastAmount: inv.lastAmount,
      month: inv.month,
      monthCol: inv.monthCol,
      previousMonthCol: inv.previousMonthCol,
      multiDept: inv.multiDept,
      lines: (inv.lines || [])
        .filter(line => (line.amounts?.[inv.monthCol] || 0) > 0)
        .map(line => ({
          service: line.service,
          department: line.department,
          lead: line.lead,
          amount: line.amounts?.[inv.monthCol] || 0,
        })),
    }));

  return {
    monthKey,
    monthLabel: ctx.curLabel,
    previousMonthKey: ctx.prevKey,
    previousMonthLabel: ctx.prevLabel,
    closedAt: new Date().toISOString(),
    total: snapshotInvoices.reduce((sum, inv) => sum + inv.amount, 0),
    invoiceCount: snapshotInvoices.length,
    approvedCount: snapshotInvoices.filter(inv => inv.status === "approved").length,
    sentCount: snapshotInvoices.filter(inv => inv.status === "sent").length,
    invoices: snapshotInvoices,
  };
}

// ---------- QuickBooks via MCP ----------

const QBO_MCP = { type: "url", url: "https://ai-inc.quickbooks.intuit.com/v1/mcp", name: "quickbooks-mcp" };

async function qboCall(instruction, systemNote) {
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system:
          systemNote ||
          "You are an invoicing agent for a service agency. Use the QuickBooks tools to complete the task. When done, reply with a single short JSON object: {\"ok\": true|false, \"summary\": string, \"invoiceId\": string}. No markdown fences, no extra text.",
        messages: [{ role: "user", content: instruction }],
        mcp_servers: [QBO_MCP],
      }),
    });
  } catch {
    throw new Error("Network error reaching the AI API. If running outside claude.ai this call is blocked by CORS.");
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`QBO call failed (${res.status}). ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "";
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    return { ok: true, summary: clean.slice(0, 300), invoiceId: "" };
  }
}

// ---------- Contract parsing helpers ----------

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

function monthKeyToYearMonth(key) {
  const d = parseColDate(key);
  if (!d) return null;
  return d.getFullYear() * 12 + d.getMonth();
}

function yearMonthFromString(s) {
  // Accepts "YYYY-MM" or "YYYY-MM-DD"
  const m = String(s || "").match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

const MAX_CONTRACT_MB = 8;

async function parseContractWithAI(file) {
  if (file.size > MAX_CONTRACT_MB * 1024 * 1024) {
    throw new Error(`The file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please use a PDF under ${MAX_CONTRACT_MB} MB, ideally the contract pages with the fee and term only.`);
  }
  const base64Data = await fileToBase64(file);
  const system = `You are a contract data extractor for a service agency's invoicing system.
Read the attached contract and extract the billing details.
Respond ONLY with a valid JSON object, no markdown fences, no preamble, with exactly these keys:
{
  "clientName": string,            // the client / counterparty company name
  "service": string,               // short description of the contracted service
  "department": string,            // department if identifiable, otherwise ""
  "monthlyFee": number,            // the fixed monthly fee as a plain number, no currency symbols
  "currency": string,              // e.g. "USD"
  "startDate": string,             // contract start in YYYY-MM format, "" if not found
  "endDate": string,               // contract end in YYYY-MM format, "" if open-ended or not found
  "notes": string                  // anything relevant for billing: setup fees, escalations, payment terms
}
If the fee is stated annually, divide by 12. If multiple fees exist, use the recurring monthly fixed fee.`;

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
              { type: "text", text: "Extract the billing details from this contract as JSON." },
            ],
          },
        ],
      }),
    });
  } catch {
    throw new Error("Network error calling the AI API (Failed to fetch). If you are running this app outside claude.ai, direct browser calls to api.anthropic.com are blocked by CORS and need a backend proxy. If you are inside claude.ai, try a smaller PDF or check your connection.");
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`The AI API returned ${res.status}. ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "";
  const clean = text.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error("The AI response could not be read as structured data. Try again or use a clearer PDF.");
  }

  return {
    clientName: String(parsed.clientName || "").trim(),
    service: String(parsed.service || "").trim(),
    department: String(parsed.department || "").trim(),
    monthlyFee: Number(parsed.monthlyFee) || 0,
    currency: String(parsed.currency || "USD").trim(),
    startDate: String(parsed.startDate || "").trim(),
    endDate: String(parsed.endDate || "").trim(),
    notes: String(parsed.notes || "").trim(),
  };
}

export default function App() {
  const [storageLoading, setStorageLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [showImport, setShowImport] = useState(false);
  const [importStep, setImportStep] = useState("clients");
  const [clientPaste, setClientPaste] = useState("");
  const [leadPaste, setLeadPaste] = useState("");
  const [importError, setImportError] = useState("");
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClient, setNewClient] = useState({ name: "", service: "", department: "", lead: "", currentAmt: "", nextAmt: "" });

  const [rawRows, setRawRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [approvers, setApprovers] = useState([]);
  const [approvalHistory, setApprovalHistory] = useState({});
  const [monthCols, setMonthCols] = useState([]);
  const [connected, setConnected] = useState(false);
  const [curColKey, setCurColKey] = useState("");
  const [approvalMonthKey, setApprovalMonthKey] = useState("");

  const [closedMonths, setClosedMonths] = useState([]);
  const [selectedClosedMonthKey, setSelectedClosedMonthKey] = useState("");
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const [showApprove, setShowApprove] = useState(null);
  const [showInvoiceDetail, setShowInvoiceDetail] = useState(null);
  const [approveComment, setApproveComment] = useState("");
  const [qboConnected, setQboConnected] = useState(false);
  const [qboSyncing, setQboSyncing] = useState(false);
  const [qboCompany, setQboCompany] = useState("");
  const [qboError, setQboError] = useState("");
  const [qboSendingId, setQboSendingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Contract upload state
  const [showContract, setShowContract] = useState(false);
  const [contractStep, setContractStep] = useState("upload"); // upload | review
  const [contractFile, setContractFile] = useState(null);
  const [contractParsing, setContractParsing] = useState(false);
  const [contractError, setContractError] = useState("");
  const [contractResult, setContractResult] = useState(null);

  const [aiMessages, setAiMessages] = useState([
    { role: "assistant", content: "Hi! Import your data from Google Sheets and then ask me anything about your clients, invoices, or monthly performance." },
  ]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages]);

  const billingContext = useMemo(() => getMonthContext(monthCols, curColKey), [monthCols, curColKey]);
  const approvalMonthOptions = useMemo(() => monthCols, [monthCols]);
  const effectiveApprovalMonthKey = approvalMonthKey || billingContext.curKey || approvalMonthOptions[approvalMonthOptions.length - 1]?.h || "";
  const approvalContext = useMemo(() => getMonthContext(monthCols, effectiveApprovalMonthKey), [monthCols, effectiveApprovalMonthKey]);

  const currentMonthLabel = billingContext.curLabel;
  const lastMonthLabel = billingContext.prevLabel;
  const nextMonthLabel = billingContext.nextLabel;

  const scopedClients = useMemo(() => clients.map(client => enrichClientForContext(client, billingContext)), [clients, billingContext]);
  const billingInvoices = useMemo(
    () => scopedClients.map(client => buildInvoiceRecord(client, billingContext, approvalHistory, approvers[0] || "")),
    [scopedClients, billingContext, approvalHistory, approvers]
  );
  const approvalInvoices = useMemo(
    () => clients.map(client => buildInvoiceRecord(enrichClientForContext(client, approvalContext), approvalContext, approvalHistory, approvers[0] || "")),
    [clients, approvalContext, approvalHistory, approvers]
  );
  const closedMonthRecords = useMemo(() => normalizeClosedMonths(closedMonths), [closedMonths]);
  const closedMonthKeys = useMemo(() => closedMonthRecords.map(month => month.monthKey), [closedMonthRecords]);
  const selectedClosedMonth = useMemo(
    () => closedMonthRecords.find(month => month.monthKey === selectedClosedMonthKey) || closedMonthRecords[closedMonthRecords.length - 1] || null,
    [closedMonthRecords, selectedClosedMonthKey]
  );

  function buildSnapshot(overrides = {}) {
    return {
      rawRows: overrides.rawRows ?? rawRows,
      clients: overrides.clients ?? clients,
      approvers: overrides.approvers ?? approvers,
      approvalHistory: overrides.approvalHistory ?? approvalHistory,
      monthCols: (overrides.monthCols ?? monthCols).map((col, idx) => ({ h: col.h, i: col.i ?? idx })),
      curColKey: overrides.curColKey ?? billingContext.curKey,
      approvalMonthKey: overrides.approvalMonthKey ?? effectiveApprovalMonthKey,
      closedMonths: overrides.closedMonths ?? closedMonthRecords,
      connected: overrides.connected ?? connected,
    };
  }

  async function persistSnapshot(overrides = {}) {
    setSaving(true);
    setSaveError("");
    const snapshot = buildSnapshot(overrides);
    saveLocalBackup(snapshot);
    try {
      await saveToSupabase(snapshot);
    } catch (error) {
      console.error(error);
      setSaveError("Saved locally. Supabase save failed.");
    }
    setSaving(false);
  }

  useEffect(() => {
    async function load() {
      try {
        const d = (await loadFromSupabase()) || loadLocalBackup();
        const loadedClients = d?.clients || [];
        if (loadedClients.length || d?.rawRows?.length) {
          const loadedMonthCols = normalizeMonthCols(d.monthCols || [], loadedClients);
          const initialContext = getMonthContext(loadedMonthCols, d.curColKey || "");
          const initialApprovalKey = d.approvalMonthKey || initialContext.curKey || "";

          setRawRows(d.rawRows || []);
          setClients(loadedClients);
          setApprovers(d.approvers || []);
          setApprovalHistory(d.approvalHistory || migrateApprovalHistory(d.invoices));
          const loadedClosedMonths = normalizeClosedMonths(d.closedMonths || []);
          setClosedMonths(loadedClosedMonths);
          setSelectedClosedMonthKey(loadedClosedMonths[loadedClosedMonths.length - 1]?.monthKey || "");
          setMonthCols(loadedMonthCols);
          setCurColKey(initialContext.curKey);
          setApprovalMonthKey(initialApprovalKey);
          setConnected(true);
          setAiMessages([{ role: "assistant", content: `Data loaded: ${loadedClients.length} clients. Ask me anything!` }]);
        }
      } catch (error) {
        console.error(error);
        const d = loadLocalBackup();
        const loadedClients = d?.clients || [];
        if (loadedClients.length || d?.rawRows?.length) {
          const loadedMonthCols = normalizeMonthCols(d.monthCols || [], loadedClients);
          const initialContext = getMonthContext(loadedMonthCols, d.curColKey || "");
          const initialApprovalKey = d.approvalMonthKey || initialContext.curKey || "";

          setRawRows(d.rawRows || []);
          setClients(loadedClients);
          setApprovers(d.approvers || []);
          setApprovalHistory(d.approvalHistory || migrateApprovalHistory(d.invoices));
          const loadedClosedMonths = normalizeClosedMonths(d.closedMonths || []);
          setClosedMonths(loadedClosedMonths);
          setSelectedClosedMonthKey(loadedClosedMonths[loadedClosedMonths.length - 1]?.monthKey || "");
          setMonthCols(loadedMonthCols);
          setCurColKey(initialContext.curKey);
          setApprovalMonthKey(initialApprovalKey);
          setConnected(true);
          setSaveError("Loaded local backup. Supabase load failed.");
          setAiMessages([{ role: "assistant", content: `Local backup loaded: ${loadedClients.length} clients. Supabase needs attention.` }]);
        } else {
          setSaveError("Could not load saved data from Supabase.");
        }
      }
      setStorageLoading(false);
    }

    load();
  }, []);

  async function updateAmount(clientId, field, newVal) {
    const monthKey = field === "amount" ? billingContext.curKey : billingContext.nextKey;
    if (!monthKey) return;

    const updatedClients = clients.map(client => {
      if (client.id !== clientId) return client;
      return {
        ...client,
        lines: cloneLinesWithAdjustedTotal(client.lines, monthKey, newVal),
      };
    });

    setClients(updatedClients);
    await persistSnapshot({ clients: updatedClients });
  }

  async function archiveClient(clientId) {
    const updatedClients = clients.map(client => (client.id === clientId ? { ...client, status: "archived" } : client));
    setClients(updatedClients);
    await persistSnapshot({ clients: updatedClients });
  }

  async function addClientManually() {
    if (!newClient.name.trim()) return;

    const id = `manual-${Date.now()}`;
    const curAmt = parseFloat(newClient.currentAmt) || 0;
    const nextAmt = parseFloat(newClient.nextAmt) || 0;
    const lead = newClient.lead.trim() || getDefaultLead(newClient.department) || "";
    const line = {
      _id: id,
      clientName: newClient.name.trim(),
      service: newClient.service,
      department: newClient.department,
      lead,
      amounts: { [billingContext.curKey]: curAmt, [billingContext.nextKey]: nextAmt },
    };

    const updatedClients = [
      ...clients,
      {
        id,
        name: newClient.name.trim(),
        status: "active",
        lead,
        manual: true,
        lines: [line],
      },
    ];

    setClients(updatedClients);
    setShowAddClient(false);
    setNewClient({ name: "", service: "", department: "", lead: "", currentAmt: "", nextAmt: "" });
    await persistSnapshot({ clients: updatedClients, connected: true });
  }

  // ---------- Contract flow ----------

  function resetContractModal() {
    setShowContract(false);
    setContractStep("upload");
    setContractFile(null);
    setContractParsing(false);
    setContractError("");
    setContractResult(null);
  }

  async function handleParseContract() {
    if (!contractFile) return;
    setContractParsing(true);
    setContractError("");
    try {
      const result = await parseContractWithAI(contractFile);
      if (!result.clientName) throw new Error("Could not identify the client name in the contract.");
      if (!result.monthlyFee) throw new Error("Could not identify a monthly fixed fee in the contract.");
      setContractResult(result);
      setContractStep("review");
    } catch (e) {
      setContractError(e.message || "Could not parse the contract. Try another file.");
    }
    setContractParsing(false);
  }

  function buildContractAmounts(result) {
    const startYM = yearMonthFromString(result.startDate);
    const endYM = yearMonthFromString(result.endDate);
    const amounts = {};
    monthCols.forEach(col => {
      const ym = monthKeyToYearMonth(col.h);
      if (ym === null) return;
      const afterStart = startYM === null || ym >= startYM;
      const beforeEnd = endYM === null || ym <= endYM;
      amounts[col.h] = afterStart && beforeEnd ? result.monthlyFee : 0;
    });
    return amounts;
  }

  async function applyContract() {
    if (!contractResult || !monthCols.length) return;

    const result = contractResult;
    const amounts = buildContractAmounts(result);
    const key = makeClientKey(result.clientName);
    const existing = clients.find(c => makeClientKey(c.name) === key);
    const lead = existing?.lead || getDefaultLead(result.department) || "";
    const contractMeta = {
      fileName: contractFile?.name || "contract.pdf",
      monthlyFee: result.monthlyFee,
      currency: result.currency,
      startDate: result.startDate,
      endDate: result.endDate,
      notes: result.notes,
      parsedAt: new Date().toISOString(),
    };

    const newLine = {
      _id: `contract-${Date.now()}`,
      clientName: result.clientName,
      service: result.service || "Fixed fee (contract)",
      department: result.department || "",
      lead,
      fromContract: true,
      amounts,
    };

    let updatedClients;
    if (existing) {
      updatedClients = clients.map(c =>
        c.id === existing.id ? { ...c, contract: contractMeta, lines: [...(c.lines || []), newLine] } : c
      );
    } else {
      updatedClients = [
        ...clients,
        {
          id: `contract-${Date.now()}`,
          name: result.clientName,
          status: "active",
          lead,
          manual: true,
          contract: contractMeta,
          lines: [newLine],
        },
      ];
    }

    setClients(updatedClients);
    resetContractModal();
    setAiMessages(prev => [
      ...prev,
      { role: "assistant", content: `Contract loaded for ${result.clientName}: ${fmt(result.monthlyFee)} / month${result.startDate ? `, from ${result.startDate}` : ""}${result.endDate ? ` to ${result.endDate}` : ""}. Billing was added automatically.` },
    ]);
    await persistSnapshot({ clients: updatedClients, connected: true });
  }

  async function processImport() {
    setImportError("");

    try {
      const clientRows = parsePaste(clientPaste);
      const { objects, headers } = rowsToObjects(clientRows);
      if (!objects.length) throw new Error("No data found. Make sure to include the header row.");

      const cols = getMonthCols(headers);
      if (!cols.length) throw new Error("No month columns found. Expected format: 01/01/2025 or Jan 2025.");

      const importContext = getMonthContext(cols, curColKey);
      const nameKey = headers.find(h => /client.*name|^client$/i.test(h));
      const serviceKey = headers.find(h => /^service$/i.test(h));
      const deptKey = headers.find(h => /department|dept/i.test(h));
      if (!nameKey) throw new Error("Could not find a 'Client Name' column.");

      let leadMap = {};
      let approverNames = [];
      if (leadPaste.trim()) {
        const leadRows = parsePaste(leadPaste);
        const { objects: leadObjects, headers: leadHeaders } = rowsToObjects(leadRows);
        const clientCol = leadHeaders.find(h => /^client$/i.test(h)) || leadHeaders[0];
        const leadCol = leadHeaders.find(h => /^lead$/i.test(h)) || leadHeaders[1];
        leadObjects.forEach(row => {
          const clientName = row[clientCol]?.trim();
          const leadName = row[leadCol]?.trim();
          if (clientName && leadName) leadMap[makeClientKey(clientName)] = leadName;
        });
        approverNames = [...new Set(leadObjects.map(row => row[leadCol]).filter(Boolean))];
      }

      const resolveLead = (name, dept, existingLead) => leadMap[makeClientKey(name)] || existingLead || getDefaultLead(dept) || "";
      const enriched = objects
        .filter(row => row[nameKey]?.trim())
        .map((row, idx) => {
          const dept = deptKey ? row[deptKey] || "" : "";
          const clientName = row[nameKey].trim();
          return {
            _id: idx,
            clientName,
            service: serviceKey ? row[serviceKey] || "" : "",
            department: dept,
            lead: resolveLead(clientName, dept, ""),
            amounts: Object.fromEntries(cols.map(c => [c.h, parseAmount(row[c.h])])),
          };
        });

      const grouped = {};
      enriched.forEach(row => {
        if (!grouped[row.clientName]) grouped[row.clientName] = { name: row.clientName, lines: [] };
        grouped[row.clientName].lines.push(row);
      });

      const existingByKey = Object.fromEntries(clients.map(client => [makeClientKey(client.name), client]));
      const importedKeys = new Set(Object.keys(grouped).map(makeClientKey));

      const importedClients = Object.values(grouped).map((group, idx) => {
        const existing = existingByKey[makeClientKey(group.name)];
        const lead = resolveLead(group.name, group.lines[0]?.department || "", existing?.lead);
        const contractLines = (existing?.lines || []).filter(line => line.fromContract);
        return {
          id: existing?.id || `import-${idx + 1}`,
          name: group.name,
          status: existing?.status || "active",
          lead,
          manual: false,
          contract: existing?.contract,
          lines: [...group.lines.map(line => ({ ...line, lead: line.lead || lead })), ...contractLines],
        };
      });

      const manualOnlyClients = clients.filter(client => client.manual && !importedKeys.has(makeClientKey(client.name)));
      const updatedClients = [...importedClients, ...manualOnlyClients];
      const updatedApprovers = approverNames.length ? approverNames : approvers;
      const updatedApprovalMonthKey = cols.find(c => c.h === effectiveApprovalMonthKey) ? effectiveApprovalMonthKey : importContext.curKey;

      setRawRows(enriched);
      setClients(updatedClients);
      setApprovers(updatedApprovers);
      setMonthCols(cols);
      setCurColKey(importContext.curKey);
      setApprovalMonthKey(updatedApprovalMonthKey);
      setConnected(true);
      setShowImport(false);
      setClientPaste("");
      setLeadPaste("");
      setImportStep("clients");
      setAiMessages([{ role: "assistant", content: `Synced ${updatedClients.length} clients with ${enriched.length} service lines. Ask me anything!` }]);

      await persistSnapshot({
        rawRows: enriched,
        clients: updatedClients,
        approvers: updatedApprovers,
        monthCols: cols,
        curColKey: importContext.curKey,
        approvalMonthKey: updatedApprovalMonthKey,
        connected: true,
      });
    } catch (e) {
      setImportError(e.message);
    }
  }

  async function saveApprovalEntry(monthKey, clientName, patch) {
    const clientKey = makeClientKey(clientName);
    const updatedApprovalHistory = {
      ...approvalHistory,
      [monthKey]: {
        ...(approvalHistory[monthKey] || {}),
        [clientKey]: {
          ...(approvalHistory[monthKey]?.[clientKey] || {}),
          ...patch,
        },
      },
    };

    setApprovalHistory(updatedApprovalHistory);
    await persistSnapshot({ approvalHistory: updatedApprovalHistory });
  }

  async function approveInvoice(decision) {
    if (!showApprove) return;
    await saveApprovalEntry(showApprove.approvalMonthKey, showApprove.clientName, {
      status: decision,
      comment: approveComment,
      approver: showApprove.approver || "",
    });
    setApproveComment("");
    setShowApprove(null);
  }

  async function resetApprovalsForMonth() {
    if (!effectiveApprovalMonthKey) return;
    const updatedApprovalHistory = { ...approvalHistory };
    delete updatedApprovalHistory[effectiveApprovalMonthKey];
    setApprovalHistory(updatedApprovalHistory);
    await persistSnapshot({ approvalHistory: updatedApprovalHistory });
  }

  async function closeMonth() {
    if (!effectiveApprovalMonthKey) return;
    if (!canCloseApprovalMonth) return;

    const monthRecord = buildClosedMonthRecord(effectiveApprovalMonthKey, approvalContext, approvalBase);
    const updatedClosed = [...closedMonthRecords.filter(month => month.monthKey !== effectiveApprovalMonthKey), monthRecord];
    setClosedMonths(updatedClosed);
    setSelectedClosedMonthKey(effectiveApprovalMonthKey);
    setShowCloseConfirm(false);

    const nextKey = approvalContext.nextKey;
    if (nextKey) {
      setApprovalMonthKey(nextKey);
      setCurColKey(nextKey);
      await persistSnapshot({ closedMonths: updatedClosed, approvalMonthKey: nextKey, curColKey: nextKey });
    } else {
      await persistSnapshot({ closedMonths: updatedClosed });
    }
  }

  const activeClients = scopedClients.filter(client => client.status === "active");
  const totalProjected = activeClients.reduce((sum, client) => sum + client.amount, 0);
  const totalLast = activeClients.reduce((sum, client) => sum + client.lastAmount, 0);
  const totalNext = activeClients.reduce((sum, client) => sum + client.nextAmount, 0);

  const [filterLead, setFilterLead] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const approvalBase = approvalInvoices.filter(inv => inv.amount > 0);
  const approvalLeads = ["all", ...new Set(approvalBase.map(inv => inv.lead).filter(Boolean))];
  const approvalStatuses = ["all", "pending", "approved", "see notes", "rejected", "sent"];
  const filteredApprovals = approvalBase
    .filter(inv => filterLead === "all" || inv.lead === filterLead)
    .filter(inv => filterStatus === "all" || inv.status === filterStatus);

  const pendingCount = approvalBase.filter(inv => inv.status === "pending").length;
  const approvedCount = approvalBase.filter(inv => inv.status === "approved").length;
  const isCurrentApprovalMonthClosed = closedMonthKeys.includes(effectiveApprovalMonthKey);
  const notApprovedCount = approvalBase.filter(inv => !["approved", "sent"].includes(inv.status)).length;
  const canCloseApprovalMonth = approvalBase.length > 0 && notApprovedCount === 0;

  async function connectQBO() {
    setQboSyncing(true);
    setQboError("");
    try {
      const result = await qboCall(
        "Get the QuickBooks company information and confirm the connection.",
        'You verify a QuickBooks connection. Use the company info tool. Reply only with JSON: {"ok": true|false, "summary": "<company name>"}. No markdown, no extra text.'
      );
      if (result.ok === false) throw new Error(result.summary || "QuickBooks did not respond.");
      setQboConnected(true);
      setQboCompany(result.summary || "");
    } catch (e) {
      setQboError(e.message);
      setQboConnected(false);
    }
    setQboSyncing(false);
  }

  async function sendInvoiceToQBO(inv) {
    if (qboSendingId) return;
    setQboSendingId(inv.id);
    setQboError("");
    const activeLines = (inv.lines || []).filter(line => (line.amounts?.[inv.monthCol] || 0) > 0);
    const lineSpec = activeLines.length
      ? activeLines.map(line => ({
          description: [line.service, line.department].filter(Boolean).join(" — ") || "Monthly fixed fee",
          amount: line.amounts[inv.monthCol],
        }))
      : [{ description: "Monthly fixed fee", amount: inv.amount }];

    const instruction = `Create an invoice in QuickBooks Online for the customer "${inv.clientName}" for the billing period ${inv.month}.
Steps:
1. Search for the customer by name. If it does not exist, create it with that name.
2. Search the product/service catalog for a suitable generic service item (e.g. "Services" or "Hours"). If none exists, create one named "Monthly Services".
3. Create the invoice with these lines (one line per entry, description and amount in USD):
${JSON.stringify(lineSpec)}
Total must be ${inv.amount}.
Do NOT email the invoice to the customer, only create it as a draft in QuickBooks.`;

    try {
      const result = await qboCall(instruction);
      if (result.ok === false) throw new Error(result.summary || "QuickBooks rejected the invoice.");
      await saveApprovalEntry(inv.approvalMonthKey, inv.clientName, {
        status: "sent",
        comment: result.invoiceId ? `QBO invoice ${result.invoiceId}` : result.summary || inv.comment || "",
        approver: inv.approver || "",
      });
    } catch (e) {
      setQboError(`${inv.clientName}: ${e.message}`);
    }
    setQboSendingId("");
  }

  async function resubmitInvoice(inv) {
    await saveApprovalEntry(inv.approvalMonthKey, inv.clientName, {
      status: "pending",
      comment: "",
      approver: inv.approver || "",
    });
  }

  async function sendAI() {
    if (!aiInput.trim() || aiLoading) return;
    const userMsg = aiInput.trim();
    setAiInput("");
    setAiMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setAiLoading(true);

    const ctx = `You are a finance assistant for a service business agency.
CLIENTS: ${JSON.stringify(scopedClients.map(c => ({ name: c.name, lead: c.lead, projectedAmount: c.amount, previousAmount: c.lastAmount, nextAmount: c.nextAmount, hasContract: !!c.contract, contract: c.contract ? { monthlyFee: c.contract.monthlyFee, startDate: c.contract.startDate, endDate: c.contract.endDate } : null })))}
INVOICES: ${JSON.stringify(billingInvoices.map(i => ({ client: i.clientName, lead: i.lead, amount: i.amount, status: i.status })))}
PROJECTED MONTH: ${currentMonthLabel}, PREVIOUS MONTH: ${lastMonthLabel}, NEXT MONTH: ${nextMonthLabel}
TOTAL PROJECTED MONTH: ${fmt(totalProjected)}, TOTAL PREVIOUS MONTH: ${fmt(totalLast)}, TOTAL NEXT MONTH: ${fmt(totalNext)}
Answer concisely in English. Use USD formatting.`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: ctx,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      const data = await res.json();
      const reply = data.content?.find(block => block.type === "text")?.text || "Could not process that.";
      setAiMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setAiMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    }
    setAiLoading(false);
  }

  const tabs = ["dashboard", "clients", "invoices", "invoice approvals", "closed months", "ai assistant"];

  if (storageLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading data...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">InvoiceFlow</h1>
          <p className="text-xs text-gray-400">Service Business Dashboard</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {saving && <span className="text-xs text-gray-400">Saving...</span>}
          {saveError && <span className="text-xs font-medium text-red-500">{saveError}</span>}

          {monthCols.length > 0 && (
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-400">Billing month:</span>
              <select
                value={billingContext.curKey}
                onChange={async e => {
                  const newKey = e.target.value;
                  setCurColKey(newKey);
                  if (!approvalMonthKey) setApprovalMonthKey(newKey);
                  await persistSnapshot({ curColKey: newKey, approvalMonthKey: approvalMonthKey || newKey });
                }}
                className="text-xs font-medium text-gray-700 outline-none bg-transparent"
              >
                {monthCols.map(col => (
                  <option key={col.h} value={col.h}>
                    {formatMonthLabel(col.d)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => {
              setShowContract(true);
              setContractStep("upload");
              setContractError("");
              setContractResult(null);
              setContractFile(null);
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Upload Contract
          </button>

          {approvedCount > 0 && (
            <button
              onClick={() => {
                const approved = approvalInvoices.filter(inv => inv.status === "approved");
                const rows = [["Client", "Lead", "Department", "Service", "Month", "Amount"]];
                approved.forEach(inv => {
                  const lines = inv.lines?.filter(line => (line.amounts[inv.monthCol] || 0) > 0) || [];
                  if (!lines.length) rows.push([inv.clientName, inv.lead, "", "", inv.month, inv.amount]);
                  else lines.forEach(line => rows.push([inv.clientName, inv.lead, line.department, line.service, inv.month, line.amounts[inv.monthCol]]));
                });
                const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                a.download = `approved-${(approvalContext.curLabel || "approvals").replace(" ", "-")}.csv`;
                a.click();
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              Export Approved CSV
            </button>
          )}

          <button
            onClick={() => {
              setShowImport(true);
              setImportStep("clients");
              setImportError("");
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
              connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-900 bg-gray-900 text-white hover:bg-gray-700"
            }`}
          >
            {connected ? `Synced: ${clients.length} clients — Re-import` : "Import from Sheet"}
          </button>

          {qboError && <span className="text-xs font-medium text-red-500 max-w-xs truncate" title={qboError}>{qboError}</span>}
          <button
            onClick={qboConnected || qboSyncing ? undefined : connectQBO}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              qboConnected ? "bg-emerald-50 text-emerald-700 cursor-default border border-emerald-200" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
            title={qboCompany ? `Connected to ${qboCompany}` : "Verifies the connection through your QuickBooks connector in claude.ai"}
          >
            {qboSyncing ? "Connecting..." : qboConnected ? `QBO Connected${qboCompany ? ` — ${qboCompany}` : ""}` : "Connect QuickBooks"}
          </button>
        </div>
      </div>

      <div className="bg-white border-b border-gray-100 px-6 overflow-x-auto">
        <div className="flex gap-6 min-w-max">
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors capitalize whitespace-nowrap ${
                tab === t ? "border-gray-900 text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              {t === "invoice approvals" && pendingCount > 0 ? (
                <span className="flex items-center gap-1.5">
                  Invoice Approvals
                  <span className="bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">{pendingCount}</span>
                </span>
              ) : (
                t.charAt(0).toUpperCase() + t.slice(1)
              )}
            </button>
          ))}
        </div>
      </div>

      {!connected && (
        <div className="max-w-6xl mx-auto px-6 pt-6">
          <div className="bg-blue-50 border border-blue-100 rounded-2xl px-6 py-4 text-sm text-blue-700 flex items-center justify-between">
            <span>Import your data from Google Sheets to get started.</span>
            <button onClick={() => setShowImport(true)} className="ml-4 bg-blue-700 text-white px-4 py-1.5 rounded-lg text-xs hover:bg-blue-800">
              Import now
            </button>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 py-8">
        {tab === "dashboard" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                { label: `Projected — ${currentMonthLabel || "selected month"}`, value: fmt(totalProjected), sub: `${activeClients.length} active clients` },
                { label: `Previous — ${lastMonthLabel || "previous month"}`, value: fmt(totalLast), sub: "actual previous month" },
                {
                  label: "Month-over-Month",
                  value: (totalProjected - totalLast >= 0 ? "+" : "") + fmt(totalProjected - totalLast),
                  sub: totalProjected >= totalLast ? "increase" : "decrease",
                  color: totalProjected >= totalLast ? "text-emerald-600" : "text-red-500",
                },
                { label: "Pending Approval", value: pendingCount, sub: `${approvedCount} approved` },
              ].map(card => (
                <div key={card.label} className="bg-white rounded-2xl p-5 border border-gray-100">
                  <p className="text-xs text-gray-400 mb-1">{card.label}</p>
                  <p className={`text-2xl font-semibold ${card.color || "text-gray-900"}`}>{card.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <h2 className="font-medium text-gray-800">Month Comparison by Client</h2>
                <span className="text-xs text-gray-400">
                  {currentMonthLabel} vs {lastMonthLabel || "previous month"}
                </span>
              </div>
              {scopedClients.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-300 text-sm">Import your data to see the comparison</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-50">
                      <th className="px-6 py-3 text-left">Client</th>
                      <th className="px-6 py-3 text-left">Lead</th>
                      <th className="px-6 py-3 text-left">Departments</th>
                      <th className="px-6 py-3 text-right">{lastMonthLabel || "Previous"}</th>
                      <th className="px-6 py-3 text-right">{currentMonthLabel || "Projected"}</th>
                      <th className="px-6 py-3 text-right">Change</th>
                      <th className="px-6 py-3 text-left">Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeClients
                      .filter(client => client.amount > 0 || client.lastAmount > 0)
                      .map(client => {
                        const diff = client.amount - client.lastAmount;
                        const inv = billingInvoices.find(invoice => invoice.clientId === client.id);
                        const depts = [...new Set(client.lines.map(line => line.department))].filter(Boolean);
                        return (
                          <tr key={client.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-3 font-medium text-gray-800">
                              {client.name}
                              {client.contract && <span className="ml-2 text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">contract</span>}
                            </td>
                            <td className="px-6 py-3 text-xs text-gray-500">{client.lead || "—"}</td>
                            <td className="px-6 py-3">
                              <div className="flex flex-wrap gap-1">
                                {depts.map(dept => (
                                  <span key={dept} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">
                                    {dept}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-6 py-3 text-right text-gray-500">{fmt(client.lastAmount)}</td>
                            <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(client.amount)}</td>
                            <td className={`px-6 py-3 text-right font-medium ${diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                              {diff >= 0 ? "+" : ""}
                              {fmt(diff)}
                            </td>
                            <td className="px-6 py-3">{inv && <Badge status={inv.status} />}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>
            <NewProjectedClients clients={activeClients} currentMonthLabel={currentMonthLabel} lastMonthLabel={lastMonthLabel} />
          </div>
        )}

        {tab === "clients" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-medium text-gray-800">Clients ({activeClients.length} active · {rawRows.length} service lines)</h2>
              <div className="flex gap-2 items-center">
                {monthCols.length > 0 && (
                  <select
                    value={billingContext.curKey}
                    onChange={async e => {
                      const newKey = e.target.value;
                      setCurColKey(newKey);
                      await persistSnapshot({ curColKey: newKey });
                    }}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none text-gray-600"
                  >
                    {monthCols.map(col => (
                      <option key={col.h} value={col.h}>
                        {formatMonthLabel(col.d)}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => {
                    setShowContract(true);
                    setContractStep("upload");
                    setContractError("");
                    setContractResult(null);
                    setContractFile(null);
                  }}
                  className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Upload Contract
                </button>
                <button onClick={() => setShowAddClient(true)} className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors">
                  + Add Client
                </button>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2 text-xs text-blue-600">
              Click any amount in the Current or Next Month columns to edit it inline. Changes are saved automatically. You can also upload a contract PDF and the fixed fee will be loaded for every month in its term.
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {scopedClients.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-300 text-sm">No clients — import your data or upload a contract</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-50">
                      <th className="px-6 py-3 text-left">Client</th>
                      <th className="px-6 py-3 text-left">Lead</th>
                      <th className="px-6 py-3 text-left">Services</th>
                      <th className="px-6 py-3 text-left">Departments</th>
                      <th className="px-6 py-3 text-left">Contract</th>
                      <th className="px-6 py-3 text-right">{currentMonthLabel || "Current"}</th>
                      <th className="px-6 py-3 text-right">{nextMonthLabel || "Next"}</th>
                      <th className="px-6 py-3 text-left">QBO Lines</th>
                      <th className="px-6 py-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopedClients.map(client => {
                      const services = [...new Set(client.lines.map(line => line.service))].filter(Boolean);
                      const depts = [...new Set(client.lines.map(line => line.department))].filter(Boolean);
                      return (
                        <tr key={client.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-3 font-medium text-gray-800">{client.name}</td>
                          <td className="px-6 py-3 text-xs text-gray-500">{client.lead || "—"}</td>
                          <td className="px-6 py-3 text-gray-500 text-xs">{services.join(", ")}</td>
                          <td className="px-6 py-3">
                            <div className="flex flex-wrap gap-1">
                              {depts.map(dept => (
                                <span key={dept} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">
                                  {dept}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-3 text-xs">
                            {client.contract ? (
                              <span
                                className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full cursor-help"
                                title={`${client.contract.fileName} · ${fmt(client.contract.monthlyFee)}/mo${client.contract.startDate ? ` · ${client.contract.startDate}` : ""}${client.contract.endDate ? ` to ${client.contract.endDate}` : ""}${client.contract.notes ? ` · ${client.contract.notes}` : ""}`}
                              >
                                {fmt(client.contract.monthlyFee)}/mo
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <EditableCell value={client.amount} onSave={value => updateAmount(client.id, "amount", value)} />
                          </td>
                          <td className="px-6 py-3 text-right">
                            <EditableCell value={client.nextAmount} onSave={value => updateAmount(client.id, "nextAmount", value)} />
                          </td>
                          <td className="px-6 py-3 text-xs">
                            {client.multiDept ? <span className="text-blue-600">{depts.length} lines</span> : <span className="text-gray-400">1 line</span>}
                          </td>
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-2">
                              <Badge status={client.status} />
                              {client.status === "active" && (
                                <button onClick={() => archiveClient(client.id)} className="text-xs text-gray-300 hover:text-red-400 transition-colors">
                                  Archive
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {tab === "invoices" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-medium text-gray-800">Invoices — {currentMonthLabel || "this month"}</h2>
              {!qboConnected && <p className="text-xs text-amber-600 bg-amber-50 px-3 py-1 rounded-full">Connect QBO to enable auto-send</p>}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {billingInvoices.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-300 text-sm">No invoices — import your data first</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-50">
                      <th className="px-6 py-3 text-left">Client</th>
                      <th className="px-6 py-3 text-left">Lead</th>
                      <th className="px-6 py-3 text-right">Amount</th>
                      <th className="px-6 py-3 text-left">QBO Lines</th>
                      <th className="px-6 py-3 text-left">Approver</th>
                      <th className="px-6 py-3 text-left">Status</th>
                      <th className="px-6 py-3 text-left">Comment</th>
                      <th className="px-6 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingInvoices.map(inv => {
                      const activeLines = inv.lines?.filter(line => (line.amounts[inv.monthCol] || 0) > 0) || [];
                      return (
                        <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-3">
                            <div className="font-medium text-gray-800">{inv.clientName}</div>
                            {activeLines.length > 0 && (
                              <button onClick={() => setShowInvoiceDetail(inv)} className="text-xs text-blue-500 hover:underline">
                                View {activeLines.length} line{activeLines.length > 1 ? "s" : ""}
                              </button>
                            )}
                          </td>
                          <td className="px-6 py-3 text-xs text-gray-500">{inv.lead || "—"}</td>
                          <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(inv.amount)}</td>
                          <td className="px-6 py-3 text-xs">
                            {inv.multiDept ? (
                              <span className="text-blue-600 font-medium">{[...new Set(inv.lines?.map(line => line.department))].filter(Boolean).length} sep. lines</span>
                            ) : (
                              <span className="text-gray-400">1 line</span>
                            )}
                          </td>
                          <td className="px-6 py-3 text-gray-500 text-xs">{inv.approver || "—"}</td>
                          <td className="px-6 py-3">
                            <Badge status={inv.status} />
                          </td>
                          <td className="px-6 py-3 text-gray-400 text-xs italic">{inv.comment || "—"}</td>
                          <td className="px-6 py-3 text-right">
                            <div className="flex gap-2 justify-end">
                              {inv.status === "pending" && (
                                <button
                                  onClick={() => {
                                    setShowApprove(inv);
                                    setApproveComment(inv.comment || "");
                                  }}
                                  className="text-xs bg-gray-900 text-white px-3 py-1 rounded-lg hover:bg-gray-700"
                                >
                                  Review
                                </button>
                              )}
                              {inv.status === "see notes" && (
                                <button
                                  onClick={() => {
                                    setShowApprove(inv);
                                    setApproveComment(inv.comment || "");
                                  }}
                                  className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg hover:bg-orange-600"
                                >
                                  See Notes
                                </button>
                              )}
                              {inv.status === "approved" && qboConnected && (
                                <button
                                  onClick={() => sendInvoiceToQBO(inv)}
                                  disabled={!!qboSendingId}
                                  className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700 disabled:opacity-40"
                                >
                                  {qboSendingId === inv.id ? "Sending..." : "Send via QBO"}
                                </button>
                              )}
                              {inv.status === "approved" && !qboConnected && <span className="text-xs text-gray-300">Connect QBO</span>}
                              {inv.status === "rejected" && (
                                <button onClick={() => resubmitInvoice(inv)} className="text-xs text-amber-600 border border-amber-200 px-3 py-1 rounded-lg hover:bg-amber-50">
                                  Resubmit
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {tab === "invoice approvals" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="font-medium text-gray-800">Invoice Approvals</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Compare projected month ({approvalContext.curLabel || "selected"}) vs previous month ({approvalContext.prevLabel || "previous"})
                </p>
              </div>

              <div className="flex flex-col gap-2 items-end">
                <div className="flex gap-2 flex-wrap justify-end items-center">
                  {approvalMonthOptions.length > 0 && (
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <span className="text-xs text-gray-400">Approval month:</span>
                      <select
                        value={effectiveApprovalMonthKey}
                        onChange={async e => {
                          const newKey = e.target.value;
                          setApprovalMonthKey(newKey);
                          setFilterLead("all");
                          setFilterStatus("all");
                          await persistSnapshot({ approvalMonthKey: newKey });
                        }}
                        className="text-xs font-medium text-gray-700 outline-none bg-transparent"
                      >
                        {approvalMonthOptions.map(col => (
                          <option key={col.h} value={col.h}>
                            {formatMonthLabel(col.d)}{closedMonthKeys.includes(col.h) ? " (closed)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {!isCurrentApprovalMonthClosed && (
                    <button onClick={resetApprovalsForMonth} disabled={!effectiveApprovalMonthKey} className="px-3 py-2 rounded-lg text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">
                      Clear approvals for this month
                    </button>
                  )}
                  {isCurrentApprovalMonthClosed ? (
                    <span className="px-3 py-2 rounded-lg text-xs font-medium bg-gray-100 text-gray-400 border border-gray-200">
                      🔒 Month closed
                    </span>
                  ) : (
                    <button
                      onClick={() => setShowCloseConfirm(true)}
                      disabled={!canCloseApprovalMonth}
                      title={
                        !approvalBase.length
                          ? "No invoices to close"
                          : !canCloseApprovalMonth
                            ? `${notApprovedCount} invoice${notApprovedCount !== 1 ? "s are" : " is"} not approved yet`
                            : `Close ${approvalContext.curLabel} and advance to ${approvalContext.nextLabel || "next month"}`
                      }
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
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                        filterLead === lead ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {lead === "all" ? "All leads" : lead}
                    </button>
                  ))}
                </div>

                <div className="flex gap-1 flex-wrap justify-end">
                  {approvalStatuses.map(status => {
                    const colors = {
                      all: "bg-gray-900 text-white",
                      pending: "bg-amber-500 text-white",
                      approved: "bg-blue-600 text-white",
                      "see notes": "bg-orange-500 text-white",
                      rejected: "bg-red-500 text-white",
                      sent: "bg-purple-600 text-white",
                    };
                    const inactive = "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50";
                    return (
                      <button
                        key={status}
                        onClick={() => setFilterStatus(status)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                          filterStatus === status ? colors[status] || "bg-gray-900 text-white" : inactive
                        }`}
                      >
                        {status === "all" ? "All statuses" : status}
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-2 text-xs">
                  <span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-full">{filteredApprovals.filter(inv => inv.status === "pending").length} pending</span>
                  <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full">{filteredApprovals.filter(inv => inv.status === "approved").length} approved</span>
                </div>
              </div>
            </div>

            {isCurrentApprovalMonthClosed && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
                <span>🔒</span>
                <span><strong>{approvalContext.curLabel}</strong> is closed. Approvals are locked and cannot be changed.</span>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {filteredApprovals.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-300 text-sm">{approvalInvoices.length === 0 ? "No invoices — import your data first" : "No invoices for this filter"}</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-50">
                      <th className="px-6 py-3 text-left">Client</th>
                      <th className="px-6 py-3 text-left">Lead</th>
                      <th className="px-6 py-3 text-left">Departments</th>
                      <th className="px-6 py-3 text-right">{approvalContext.prevLabel || "Previous"}</th>
                      <th className="px-6 py-3 text-right">{approvalContext.curLabel || "Projected"}</th>
                      <th className="px-6 py-3 text-right">Change</th>
                      <th className="px-6 py-3 text-left">Status</th>
                      <th className="px-6 py-3 text-left">Comment</th>
                      <th className="px-6 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApprovals.map(inv => {
                      const diff = inv.amount - inv.lastAmount;
                      const activeLines = inv.lines?.filter(line => (line.amounts[inv.monthCol] || 0) > 0) || [];
                      const depts = [...new Set(inv.lines?.map(line => line.department).filter(Boolean))];
                      return (
                        <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-3">
                            <div className="font-medium text-gray-800">{inv.clientName}</div>
                            {activeLines.length > 0 && (
                              <button
                                onClick={() => setShowInvoiceDetail({ ...inv, monthCol: inv.monthCol, month: approvalContext.curLabel, amount: inv.amount })}
                                className="text-xs text-blue-500 hover:underline"
                              >
                                View {activeLines.length} line{activeLines.length > 1 ? "s" : ""}
                              </button>
                            )}
                          </td>
                          <td className="px-6 py-3 text-xs text-gray-500">{inv.lead || "—"}</td>
                          <td className="px-6 py-3">
                            <div className="flex flex-wrap gap-1">
                              {depts.map(dept => (
                                <span key={dept} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">
                                  {dept}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-3 text-right text-gray-500">{fmt(inv.lastAmount)}</td>
                          <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(inv.amount)}</td>
                          <td className={`px-6 py-3 text-right font-medium ${diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {diff >= 0 ? "+" : ""}
                            {fmt(diff)}
                          </td>
                          <td className="px-6 py-3">
                            <Badge status={inv.status} />
                          </td>
                          <td className="px-6 py-3 text-gray-400 text-xs italic">{inv.comment || "—"}</td>
                          <td className="px-6 py-3 text-right">
                            {isCurrentApprovalMonthClosed ? (
                              <span className="text-xs text-gray-300">🔒 locked</span>
                            ) : (
                              <div className="flex gap-2 justify-end">
                                {inv.status === "pending" && (
                                  <button
                                    onClick={() => {
                                      setShowApprove(inv);
                                      setApproveComment(inv.comment || "");
                                    }}
                                    className="text-xs bg-gray-900 text-white px-3 py-1 rounded-lg hover:bg-gray-700"
                                  >
                                    Review
                                  </button>
                                )}
                                {inv.status === "see notes" && (
                                  <button
                                    onClick={() => {
                                      setShowApprove(inv);
                                      setApproveComment(inv.comment || "");
                                    }}
                                    className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg hover:bg-orange-600"
                                  >
                                    See Notes
                                  </button>
                                )}
                                {inv.status === "approved" && qboConnected && (
                                  <button
                                    onClick={() => sendInvoiceToQBO(inv)}
                                    disabled={!!qboSendingId}
                                    className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700 disabled:opacity-40"
                                  >
                                    {qboSendingId === inv.id ? "Sending..." : "Send via QBO"}
                                  </button>
                                )}
                                {inv.status === "approved" && !qboConnected && <span className="text-xs text-gray-300">Connect QBO</span>}
                                {inv.status === "rejected" && (
                                  <button onClick={() => resubmitInvoice(inv)} className="text-xs text-amber-600 border border-amber-200 px-3 py-1 rounded-lg hover:bg-amber-50">
                                    Resubmit
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {tab === "closed months" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="font-medium text-gray-800">Closed Months</h2>
                <p className="text-xs text-gray-400 mt-0.5">Review exactly what was approved and billed when a month was closed.</p>
              </div>
              {closedMonthRecords.length > 0 && (
                <select
                  value={selectedClosedMonth?.monthKey || ""}
                  onChange={e => setSelectedClosedMonthKey(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none text-gray-600 bg-white"
                >
                  {closedMonthRecords.map(month => (
                    <option key={month.monthKey} value={month.monthKey}>
                      {month.monthLabel || labelFromKey(month.monthKey)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {!selectedClosedMonth ? (
              <div className="bg-white rounded-2xl border border-gray-100 px-6 py-10 text-center text-gray-300 text-sm">
                No closed months yet. Once all approvals are done, close the month from Invoice Approvals.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {[
                    {
                      label: "Closed month",
                      value: selectedClosedMonth.monthLabel || labelFromKey(selectedClosedMonth.monthKey),
                      sub: selectedClosedMonth.closedAt ? new Date(selectedClosedMonth.closedAt).toLocaleDateString() : "saved",
                    },
                    { label: "Billed total", value: fmt(selectedClosedMonth.total), sub: `${selectedClosedMonth.invoiceCount || 0} invoices` },
                    { label: "Approved", value: selectedClosedMonth.approvedCount || 0, sub: "approval done" },
                    { label: "Sent", value: selectedClosedMonth.sentCount || 0, sub: "sent to QBO" },
                  ].map(card => (
                    <div key={card.label} className="bg-white rounded-2xl p-5 border border-gray-100">
                      <p className="text-xs text-gray-400 mb-1">{card.label}</p>
                      <p className="text-2xl font-semibold text-gray-900">{card.value}</p>
                      <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                    <h2 className="font-medium text-gray-800">Billed Invoices</h2>
                    <span className="text-xs text-gray-400">{selectedClosedMonth.monthLabel || labelFromKey(selectedClosedMonth.monthKey)}</span>
                  </div>
                  {!selectedClosedMonth.invoices?.length ? (
                    <div className="px-6 py-10 text-center text-gray-300 text-sm">No invoices were captured in this close.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 border-b border-gray-50">
                          <th className="px-6 py-3 text-left">Client</th>
                          <th className="px-6 py-3 text-left">Lead</th>
                          <th className="px-6 py-3 text-right">Amount</th>
                          <th className="px-6 py-3 text-left">Status</th>
                          <th className="px-6 py-3 text-left">Approver</th>
                          <th className="px-6 py-3 text-left">Comment</th>
                          <th className="px-6 py-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedClosedMonth.invoices.map(inv => (
                          <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-3 font-medium text-gray-800">{inv.clientName}</td>
                            <td className="px-6 py-3 text-xs text-gray-500">{inv.lead || "—"}</td>
                            <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(inv.amount)}</td>
                            <td className="px-6 py-3">
                              <Badge status={inv.status} />
                            </td>
                            <td className="px-6 py-3 text-xs text-gray-500">{inv.approver || "—"}</td>
                            <td className="px-6 py-3 text-gray-400 text-xs italic">{inv.comment || "—"}</td>
                            <td className="px-6 py-3 text-right">
                              {!!inv.lines?.length && (
                                <button onClick={() => setShowInvoiceDetail(inv)} className="text-xs text-blue-500 hover:underline">
                                  View {inv.lines.length} line{inv.lines.length > 1 ? "s" : ""}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "ai assistant" && (
          <div className="bg-white rounded-2xl border border-gray-100 flex flex-col" style={{ height: "520px" }}>
            <div className="px-6 py-4 border-b border-gray-50">
              <h2 className="font-medium text-gray-800">AI Finance Assistant</h2>
              <p className="text-xs text-gray-400">Ask anything about your clients, invoices, or monthly performance</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {aiMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-xs md:max-w-md px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${msg.role === "user" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800"}`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {aiLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-400 px-4 py-2.5 rounded-2xl text-sm">Thinking...</div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="px-6 py-4 border-t border-gray-50 flex gap-3">
              <input
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendAI()}
                placeholder="e.g. Which clients have more than one department?"
                className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-gray-400"
              />
              <button onClick={sendAI} disabled={aiLoading} className="bg-gray-900 text-white px-4 py-2 rounded-xl text-sm hover:bg-gray-700 disabled:opacity-40">
                Send
              </button>
            </div>
          </div>
        )}
      </div>

      {showContract && (
        <Modal title="Upload Contract" onClose={resetContractModal} wide>
          {contractStep === "upload" && (
            <div className="space-y-4">
              <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                <p className="font-medium">How it works:</p>
                <p>1. Attach the client's contract as a PDF</p>
                <p>2. The AI reads it and extracts the client, the monthly fixed fee and the contract term</p>
                <p>3. You review the extracted data and confirm</p>
                <p>4. Billing is loaded automatically for every month within the contract term</p>
              </div>

              {!monthCols.length && (
                <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700">
                  Import your sheet first so the dashboard knows which months exist. The contract fee is applied to the imported month columns.
                </div>
              )}

              <label className="block border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors">
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={e => {
                    setContractFile(e.target.files?.[0] || null);
                    setContractError("");
                  }}
                />
                {contractFile ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-800">{contractFile.name}</p>
                    <p className="text-xs text-gray-400">{(contractFile.size / 1024).toFixed(0)} KB · click to change</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-600">Click to attach the contract (PDF)</p>
                    <p className="text-xs text-gray-400">The document is read locally and analyzed by AI</p>
                  </div>
                )}
              </label>

              {contractError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{contractError}</p>}

              <div className="flex gap-3">
                <button onClick={resetContractModal} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={handleParseContract}
                  disabled={!contractFile || contractParsing || !monthCols.length}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-40"
                >
                  {contractParsing ? "Reading contract..." : "Read contract with AI"}
                </button>
              </div>
            </div>
          )}

          {contractStep === "review" && contractResult && (
            <div className="space-y-4">
              <div className="bg-emerald-50 rounded-xl p-3 text-xs text-emerald-700">
                Data extracted from <strong>{contractFile?.name}</strong>. Review and edit before confirming, then the fee will be loaded for every month within the term.
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Client name *", "clientName", "text"],
                  ["Service", "service", "text"],
                  ["Department", "department", "text"],
                  ["Currency", "currency", "text"],
                ].map(([label, key, type]) => (
                  <div key={key}>
                    <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                    <input
                      type={type}
                      value={contractResult[key]}
                      onChange={e => setContractResult(prev => ({ ...prev, [key]: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Monthly fixed fee *</label>
                  <input
                    type="number"
                    value={contractResult.monthlyFee}
                    onChange={e => setContractResult(prev => ({ ...prev, monthlyFee: parseFloat(e.target.value) || 0 }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Start (YYYY-MM)</label>
                  <input
                    type="text"
                    value={contractResult.startDate}
                    placeholder="2026-01"
                    onChange={e => setContractResult(prev => ({ ...prev, startDate: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">End (YYYY-MM, blank if open)</label>
                  <input
                    type="text"
                    value={contractResult.endDate}
                    placeholder=""
                    onChange={e => setContractResult(prev => ({ ...prev, endDate: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                  />
                </div>
              </div>

              {contractResult.notes && (
                <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600">
                  <span className="font-medium">Contract notes:</span> {contractResult.notes}
                </div>
              )}

              <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-50 text-xs text-gray-400">Billing preview per month</div>
                <div className="px-4 py-2 flex flex-wrap gap-2">
                  {monthCols.map(col => {
                    const amounts = buildContractAmounts(contractResult);
                    const amt = amounts[col.h] || 0;
                    return (
                      <span key={col.h} className={`text-xs px-2 py-1 rounded-lg ${amt > 0 ? "bg-emerald-50 text-emerald-700" : "bg-gray-50 text-gray-300"}`}>
                        {formatMonthLabel(col.d)}: {fmt(amt)}
                      </span>
                    );
                  })}
                </div>
              </div>

              {clients.some(c => makeClientKey(c.name) === makeClientKey(contractResult.clientName)) && (
                <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700">
                  This client already exists. The contract fee will be added as a new billing line on top of its current amounts.
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setContractStep("upload")}
                  className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50"
                >
                  Back
                </button>
                <button
                  onClick={applyContract}
                  disabled={!contractResult.clientName.trim() || !contractResult.monthlyFee}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-40"
                >
                  Confirm and add billing
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {showCloseConfirm && (
        <Modal title="Close Month" onClose={() => setShowCloseConfirm(false)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Close <strong>{approvalContext.curLabel}</strong>? All {approvalBase.length} approval{approvalBase.length !== 1 ? "s" : ""} will be locked and the billed invoice snapshot will be saved.
              {approvalContext.nextKey && (
                <span> The billing and approval month will advance to <strong>{approvalContext.nextLabel}</strong>.</span>
              )}
            </p>
            <p className="text-xs text-gray-400">You can review the closed month later from the Closed Months tab, even if the imported sheet changes.</p>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowCloseConfirm(false)} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={closeMonth} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700">
                Close Month
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showImport && (
        <Modal title="Import from Google Sheets" onClose={() => setShowImport(false)} wide>
          <div className="space-y-4">
            <div className="flex rounded-xl overflow-hidden border border-gray-100">
              {["clients", "leads"].map((step, idx) => (
                <button
                  key={step}
                  onClick={() => setImportStep(step)}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${importStep === step ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}
                >
                  {idx + 1}. {step === "clients" ? "Forecasted Revenues" : "Leads (team)"}
                </button>
              ))}
            </div>

            {importStep === "clients" && (
              <div className="space-y-3">
                <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                  <p className="font-medium">How to copy your data:</p>
                  <p>1. Open the <strong>Forecasted Revenues</strong> tab</p>
                  <p>2. Click on cell <strong>D1</strong> (Client Name header)</p>
                  <p>3. Select all data from D1 to the last column and row with data</p>
                  <p>4. Copy (Ctrl+C / Cmd+C) and paste below</p>
                  <p className="text-blue-500">Manual clients, contract lines and per-month approval history are preserved on re-import.</p>
                </div>
                <textarea
                  value={clientPaste}
                  onChange={e => setClientPaste(e.target.value)}
                  placeholder={"Client Name\tService\tDepartment\t01/01/2025\t02/01/2025\nAcme Corp\tPaid\tCore Growth\t4500\t5000"}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono outline-none focus:border-gray-400 resize-none"
                  rows={9}
                />
                <button onClick={() => setImportStep("leads")} disabled={!clientPaste.trim()} className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">
                  Next: Paste team data
                </button>
              </div>
            )}

            {importStep === "leads" && (
              <div className="space-y-3">
                <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                  <p className="font-medium">How to copy your team:</p>
                  <p>1. Open the <strong>Leads</strong> tab</p>
                  <p>2. Select all data including headers (<strong>Client</strong> and <strong>Lead</strong> columns)</p>
                  <p>3. Copy and paste below</p>
                </div>
                <textarea
                  value={leadPaste}
                  onChange={e => setLeadPaste(e.target.value)}
                  placeholder={"Client\tLead\nAcme Corp\tSarah Johnson"}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono outline-none focus:border-gray-400 resize-none"
                  rows={6}
                />
                {importError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{importError}</p>}
                <div className="flex gap-3">
                  <button onClick={() => setImportStep("clients")} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">
                    Back
                  </button>
                  <button onClick={processImport} disabled={!clientPaste.trim()} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">
                    Import data
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {showAddClient && (
        <Modal title="Add New Client" onClose={() => setShowAddClient(false)}>
          <div className="space-y-3">
            <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700">
              This client is added manually and won't affect your Google Sheet. It will be saved to the dashboard automatically and preserved on re-import.
            </div>
            {[["Client Name *", "name", "text"], ["Service", "service", "text"], ["Department", "department", "text"], ["Lead", "lead", "text"]].map(([label, key, type]) => (
              <div key={key}>
                <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                <input
                  type={type}
                  value={newClient[key]}
                  onChange={e => setNewClient(prev => ({ ...prev, [key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{currentMonthLabel || "Current month"} ($)</label>
                <input
                  type="number"
                  value={newClient.currentAmt}
                  onChange={e => setNewClient(prev => ({ ...prev, currentAmt: e.target.value }))}
                  placeholder="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{nextMonthLabel || "Next month"} ($)</label>
                <input
                  type="number"
                  value={newClient.nextAmt}
                  onChange={e => setNewClient(prev => ({ ...prev, nextAmt: e.target.value }))}
                  placeholder="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setShowAddClient(false);
                  setNewClient({ name: "", service: "", department: "", lead: "", currentAmt: "", nextAmt: "" });
                }}
                className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button onClick={addClientManually} disabled={!newClient.name.trim()} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">
                Add Client
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showInvoiceDetail && (
        <Modal title={`Invoice lines — ${showInvoiceDetail.clientName}`} onClose={() => setShowInvoiceDetail(null)} wide>
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              Month: {showInvoiceDetail.month} · {showInvoiceDetail.multiDept ? "Separate QBO lines per department" : "Single QBO line"}
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="py-2 text-left">Service</th>
                  <th className="py-2 text-left">Department</th>
                  <th className="py-2 text-left">Lead</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {showInvoiceDetail.lines?.filter(line => (line.amount ?? line.amounts?.[showInvoiceDetail.monthCol] ?? 0) > 0).map((line, idx) => (
                  <tr key={idx} className="border-b border-gray-50">
                    <td className="py-2 text-gray-700">
                      {line.service}
                      {line.fromContract && <span className="ml-2 text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">contract</span>}
                    </td>
                    <td className="py-2">
                      <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{line.department}</span>
                    </td>
                    <td className="py-2 text-xs text-gray-500">{line.lead || "—"}</td>
                    <td className="py-2 text-right font-medium text-gray-800">{fmt(line.amount ?? line.amounts?.[showInvoiceDetail.monthCol])}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="pt-3 text-sm font-medium text-gray-600">
                    Total
                  </td>
                  <td className="pt-3 text-right font-semibold text-gray-900">{fmt(showInvoiceDetail.amount)}</td>
                </tr>
              </tfoot>
            </table>
            <button onClick={() => setShowInvoiceDetail(null)} className="w-full border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">
              Close
            </button>
          </div>
        </Modal>
      )}

      {showApprove && (
        <Modal title={`Review Invoice — ${showApprove.clientName}`} onClose={() => setShowApprove(null)}>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Client</span>
                <span className="font-medium">{showApprove.clientName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Lead</span>
                <span>{showApprove.lead || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Previous month</span>
                <span>{fmt(showApprove.lastAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Projected month</span>
                <span className="font-semibold text-gray-900">{fmt(showApprove.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">QBO lines</span>
                <span>{showApprove.multiDept ? `${[...new Set(showApprove.lines?.map(line => line.department))].filter(Boolean).length} separate lines` : "1 line"}</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Approver</label>
              <select value={showApprove.approver} onChange={e => setShowApprove(prev => ({ ...prev, approver: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none">
                {(approvers.length ? approvers : ["—"]).map(approver => (
                  <option key={approver}>{approver}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Comment (optional)</label>
              <textarea value={approveComment} onChange={e => setApproveComment(e.target.value)} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none resize-none focus:border-gray-400" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => approveInvoice("rejected")} className="flex-1 border border-red-200 text-red-600 rounded-lg py-2 text-sm hover:bg-red-50">
                Reject
              </button>
              <button onClick={() => approveInvoice("see notes")} className="flex-1 border border-orange-200 text-orange-600 rounded-lg py-2 text-sm hover:bg-orange-50">
                See Notes
              </button>
              <button onClick={() => approveInvoice("approved")} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700">
                Approve
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, useCallback } from "react";

const SUPABASE_URL = "https://hpycqegogkqsodvykqfj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhweWNxZWdvZ2txc29kdnlrcWZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTUxMTcsImV4cCI6MjA4OTUzMTExN30.Rb5r_9gsNNVIl0e9dqYraYJdDayvunqEMfQ_I8FmfKI";

async function loadFromSupabase() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/invoiceflow_data?id=eq.main&select=data`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const rows = await res.json();
  return rows?.[0]?.data || null;
}

async function saveToSupabase(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/invoiceflow_data?id=eq.main`, {
    method: "PATCH",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase save failed: ${res.status}`);
}

function fmt(n) { return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2 }); }

const DEPT_DEFAULT_LEADS = { "fiat finance": "Kaley", uncovered: "Nick" };
function getDefaultLead(d) { return DEPT_DEFAULT_LEADS[d?.toLowerCase().trim()] || ""; }
function makeClientKey(name) { return String(name || "").trim().toLowerCase(); }

function Badge({ status }) {
  const s = { active: "bg-emerald-50 text-emerald-700", pending: "bg-amber-50 text-amber-700", approved: "bg-blue-50 text-blue-700", sent: "bg-purple-50 text-purple-700", rejected: "bg-red-50 text-red-700", archived: "bg-gray-100 text-gray-500", "see notes": "bg-orange-50 text-orange-600" };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s[status] || "bg-gray-100 text-gray-500"}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-20 p-4">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? "max-w-3xl" : "max-w-md"} p-6 max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
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
  function start() { setVal(String(value || 0)); setEditing(true); setTimeout(() => ref.current?.select(), 30); }
  function save() { const n = parseFloat(String(val).replace(/[$,]/g, "")) || 0; onSave(n); setEditing(false); }
  if (editing) return <input ref={ref} value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} className="w-24 border border-blue-300 rounded px-2 py-0.5 text-right text-xs outline-none bg-blue-50" />;
  return <span onClick={start} title="Click to edit" className="cursor-pointer hover:bg-blue-50 hover:text-blue-700 px-1 py-0.5 rounded transition-colors font-medium text-gray-800">{fmt(value)}</span>;
}

function SaveStatus({ state }) {
  if (state === "idle") return null;
  const map = { saving: "text-gray-400", saved: "text-emerald-600", error: "text-red-500" };
  const label = { saving: "Saving…", saved: "✓ Saved", error: "⚠ Save failed — check connection" };
  return <span className={`text-xs font-medium ${map[state]}`}>{label[state]}</span>;
}

function parseColDate(header) {
  const h = String(header);
  let m = h.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, 1);
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  m = h.match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (m) { const mo = months.indexOf(m[1].toLowerCase()); if (mo >= 0) return new Date(Number(m[2]), mo, 1); }
  return null;
}
function formatMonthLabel(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}
function parsePaste(text) { return text.trim().split("\n").map(r => r.split("\t").map(c => c.trim())); }
function rowsToObjects(rows) {
  if (rows.length < 2) return { objects: [], headers: [] };
  const headers = rows[0];
  return { headers, objects: rows.slice(1).filter(r => r.some(c => c)).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]))) };
}
function parseAmount(val) { return parseFloat(String(val || "").replace(/[$,\s]/g, "")) || 0; }
function getMonthCols(headers) { return headers.map((h, i) => ({ h, i, d: parseColDate(h) })).filter(x => x.d).sort((a, b) => a.d - b.d); }

function getMonthContext(cols, key) {
  if (!cols.length) return { curKey: "", nextKey: "", prevKey: "", curLabel: "", nextLabel: "", prevLabel: "" };
  const fallback = cols[cols.length - 2] || cols[cols.length - 1];
  const current = (key && cols.find(c => c.h === key)) || fallback;
  const idx = cols.findIndex(c => c.h === current.h);
  const prev = idx > 0 ? cols[idx - 1] : null;
  const next = idx < cols.length - 1 ? cols[idx + 1] : null;
  return {
    curKey: current?.h || "", nextKey: next?.h || "", prevKey: prev?.h || "",
    curLabel: current ? formatMonthLabel(current.d) : "",
    nextLabel: next ? formatMonthLabel(next.d) : "",
    prevLabel: prev ? formatMonthLabel(prev.d) : "",
  };
}
function sumForMonth(lines, monthKey) { return (lines || []).reduce((s, l) => s + (l.amounts?.[monthKey] || 0), 0); }
function enrichClient(client, ctx) {
  return { ...client, amount: sumForMonth(client.lines, ctx.curKey), lastAmount: sumForMonth(client.lines, ctx.prevKey), nextAmount: sumForMonth(client.lines, ctx.nextKey), multiDept: new Set((client.lines || []).map(l => l.department).filter(Boolean)).size > 1 };
}
function cloneLines(lines, monthKey, newTotal) {
  const next = (lines || []).map(l => ({ ...l, amounts: { ...(l.amounts || {}) } }));
  if (!monthKey || !next.length) return next;
  if (next.length === 1) { next[0].amounts[monthKey] = newTotal; return next; }
  const cur = next.reduce((s, l) => s + (l.amounts?.[monthKey] || 0), 0);
  let bigIdx = 0, big = -Infinity;
  next.forEach((l, i) => { if ((l.amounts?.[monthKey] || 0) > big) { big = l.amounts?.[monthKey] || 0; bigIdx = i; } });
  next[bigIdx].amounts[monthKey] = (next[bigIdx].amounts?.[monthKey] || 0) + (newTotal - cur);
  return next;
}
function buildInvoice(client, ctx, approvalHistory, defaultApprover) {
  const stored = approvalHistory?.[ctx.curKey]?.[makeClientKey(client.name)] || {};
  return {
    id: `${ctx.curKey}-${client.id}`, clientId: client.id, clientName: client.name,
    amount: sumForMonth(client.lines, ctx.curKey), lastAmount: sumForMonth(client.lines, ctx.prevKey), nextAmount: sumForMonth(client.lines, ctx.nextKey),
    approver: stored.approver || client.approver || defaultApprover || "",
    lead: client.lead || "", status: stored.status || "pending", comment: stored.comment || "",
    month: ctx.curLabel, monthCol: ctx.curKey, previousMonthCol: ctx.prevKey, nextMonthCol: ctx.nextKey,
    approvalMonthKey: ctx.curKey, lines: client.lines || [],
    multiDept: new Set((client.lines || []).map(l => l.department).filter(Boolean)).size > 1,
  };
}
function migrateApprovals(legacyInvoices) {
  const h = {};
  (legacyInvoices || []).forEach(inv => {
    const mk = inv.monthCol || ""; const ck = makeClientKey(inv.clientName);
    if (!mk || !ck) return;
    h[mk] = h[mk] || {};
    h[mk][ck] = { status: inv.status || "pending", comment: inv.comment || "", approver: inv.approver || "" };
  });
  return h;
}

export default function App() {
  const [storageLoading, setStorageLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("idle");
  const saveTimerRef = useRef(null);

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

  const [showApprove, setShowApprove] = useState(null);
  const [showInvoiceDetail, setShowInvoiceDetail] = useState(null);
  const [approveComment, setApproveComment] = useState("");
  const [qboConnected, setQboConnected] = useState(false);
  const [qboSyncing, setQboSyncing] = useState(false);
  const [filterLead, setFilterLead] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const [aiMessages, setAiMessages] = useState([{ role: "assistant", content: "Hi! Import your data from Google Sheets and then ask me anything." }]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const chatEndRef = useRef(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [aiMessages]);

  const billingCtx = useMemo(() => getMonthContext(monthCols, curColKey), [monthCols, curColKey]);
  const effectiveApprovalKey = approvalMonthKey || billingCtx.curKey || monthCols[monthCols.length - 1]?.h || "";
  const approvalCtx = useMemo(() => getMonthContext(monthCols, effectiveApprovalKey), [monthCols, effectiveApprovalKey]);

  const scopedClients = useMemo(() => clients.map(c => enrichClient(c, billingCtx)), [clients, billingCtx]);
  const billingInvoices = useMemo(() => scopedClients.map(c => buildInvoice(c, billingCtx, approvalHistory, approvers[0] || "")), [scopedClients, billingCtx, approvalHistory, approvers]);
  const approvalInvoices = useMemo(() => clients.map(c => buildInvoice(enrichClient(c, approvalCtx), approvalCtx, approvalHistory, approvers[0] || "")), [clients, approvalCtx, approvalHistory, approvers]);

  const activeClients = scopedClients.filter(c => c.status === "active");
  const totalProjected = activeClients.reduce((s, c) => s + c.amount, 0);
  const totalLast = activeClients.reduce((s, c) => s + c.lastAmount, 0);
  const approvalBase = approvalInvoices.filter(inv => inv.amount > 0);
  const pendingCount = approvalBase.filter(i => i.status === "pending").length;
  const approvedCount = approvalBase.filter(i => i.status === "approved").length;
  const filteredApprovals = approvalBase.filter(i => filterLead === "all" || i.lead === filterLead).filter(i => filterStatus === "all" || i.status === filterStatus);

  // ── Debounced save — always reads current state via refs ──
  const stateRef = useRef({});
  useEffect(() => {
    stateRef.current = { rawRows, clients, approvers, approvalHistory, monthCols, curColKey, approvalMonthKey, connected };
  });

  const scheduleSave = useCallback((overrides = {}) => {
    clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    saveTimerRef.current = setTimeout(async () => {
      const s = { ...stateRef.current, ...overrides };
      const snapshot = {
        rawRows: s.rawRows,
        clients: s.clients,
        approvers: s.approvers,
        approvalHistory: s.approvalHistory,
        monthCols: s.monthCols,
        curColKey: s.curColKey,
        approvalMonthKey: s.approvalMonthKey,
        connected: s.connected,
      };
      try {
        await saveToSupabase(snapshot);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2500);
      } catch (e) {
        setSaveStatus("error");
      }
    }, 700);
  }, []);

  // ── Load ──
  useEffect(() => {
    (async () => {
      try {
        const d = await loadFromSupabase();
        if (d?.clients?.length || d?.rawRows?.length) {
          // Re-hydrate Date objects lost during JSON serialization
          const loadedCols = (d.monthCols || []).map(c => ({ ...c, d: parseColDate(c.h) })).filter(c => c.d);
          const initCtx = getMonthContext(loadedCols, d.curColKey || "");
          setRawRows(d.rawRows || []);
          setClients(d.clients || []);
          setApprovers(d.approvers || []);
          setApprovalHistory(d.approvalHistory || migrateApprovals(d.invoices));
          setMonthCols(loadedCols);
          setCurColKey(initCtx.curKey);
          setApprovalMonthKey(d.approvalMonthKey || initCtx.curKey);
          setConnected(true);
          setAiMessages([{ role: "assistant", content: `Data loaded: ${(d.clients || []).length} clients. Ask me anything!` }]);
        }
      } catch (_) {}
      setStorageLoading(false);
    })();
  }, []);

  // ── Actions ──
  async function updateAmount(clientId, field, newVal) {
    const monthKey = field === "amount" ? billingCtx.curKey : billingCtx.nextKey;
    if (!monthKey) return;
    const updated = clients.map(c => c.id !== clientId ? c : { ...c, lines: cloneLines(c.lines, monthKey, newVal) });
    setClients(updated);
    scheduleSave({ clients: updated });
  }

  async function archiveClient(clientId) {
    const updated = clients.map(c => c.id === clientId ? { ...c, status: "archived" } : c);
    setClients(updated);
    scheduleSave({ clients: updated });
  }

  async function addClientManually() {
    if (!newClient.name.trim()) return;
    const id = `manual-${Date.now()}`;
    const curAmt = parseFloat(newClient.currentAmt) || 0;
    const nextAmt = parseFloat(newClient.nextAmt) || 0;
    const lead = newClient.lead.trim() || getDefaultLead(newClient.department) || "";
    const line = { _id: id, clientName: newClient.name.trim(), service: newClient.service, department: newClient.department, lead, amounts: { [billingCtx.curKey]: curAmt, [billingCtx.nextKey]: nextAmt } };
    const updated = [...clients, { id, name: newClient.name.trim(), status: "active", lead, manual: true, lines: [line] }];
    setClients(updated);
    setShowAddClient(false);
    setNewClient({ name: "", service: "", department: "", lead: "", currentAmt: "", nextAmt: "" });
    scheduleSave({ clients: updated, connected: true });
  }

  async function saveApprovalEntry(monthKey, clientName, patch) {
    const ck = makeClientKey(clientName);
    const updated = { ...approvalHistory, [monthKey]: { ...(approvalHistory[monthKey] || {}), [ck]: { ...(approvalHistory[monthKey]?.[ck] || {}), ...patch } } };
    setApprovalHistory(updated);
    scheduleSave({ approvalHistory: updated });
  }

  async function approveInvoice(decision) {
    if (!showApprove) return;
    await saveApprovalEntry(showApprove.approvalMonthKey, showApprove.clientName, { status: decision, comment: approveComment, approver: showApprove.approver || "" });
    setApproveComment(""); setShowApprove(null);
  }

  async function resetApprovalsForMonth() {
    if (!effectiveApprovalKey) return;
    const updated = { ...approvalHistory };
    delete updated[effectiveApprovalKey];
    setApprovalHistory(updated);
    scheduleSave({ approvalHistory: updated });
  }

  async function processImport() {
    setImportError("");
    try {
      const clientRows = parsePaste(clientPaste);
      const { objects, headers } = rowsToObjects(clientRows);
      if (!objects.length) throw new Error("No data found. Make sure to include the header row.");
      const cols = getMonthCols(headers).map(c => ({ ...c, d: parseColDate(c.h) })).filter(c => c.d);
      if (!cols.length) throw new Error("No month columns found. Expected format: 01/01/2025 or Jan 2025.");

      const importCtx = getMonthContext(cols, curColKey);
      const nameKey = headers.find(h => /client.*name|^client$/i.test(h));
      const serviceKey = headers.find(h => /^service$/i.test(h));
      const deptKey = headers.find(h => /department|dept/i.test(h));
      if (!nameKey) throw new Error("Could not find a 'Client Name' column.");

      let leadMap = {}, approverNames = [];
      if (leadPaste.trim()) {
        const { objects: lo, headers: lh } = rowsToObjects(parsePaste(leadPaste));
        const ck = lh.find(h => /^client$/i.test(h)) || lh[0];
        const lk = lh.find(h => /^lead$/i.test(h)) || lh[1];
        lo.forEach(r => { const cn = r[ck]?.trim(); const ln = r[lk]?.trim(); if (cn && ln) leadMap[makeClientKey(cn)] = ln; });
        approverNames = [...new Set(lo.map(r => r[lk]).filter(Boolean))];
      }

      const resolveLead = (name, dept, existing) => leadMap[makeClientKey(name)] || existing || getDefaultLead(dept) || "";
      const enriched = objects.filter(r => r[nameKey]?.trim()).map((r, i) => {
        const dept = deptKey ? r[deptKey] || "" : "";
        const cn = r[nameKey].trim();
        return { _id: i, clientName: cn, service: serviceKey ? r[serviceKey] || "" : "", department: dept, lead: resolveLead(cn, dept, ""), amounts: Object.fromEntries(cols.map(c => [c.h, parseAmount(r[c.h])])) };
      });

      const grouped = {};
      enriched.forEach(r => { if (!grouped[r.clientName]) grouped[r.clientName] = { name: r.clientName, lines: [] }; grouped[r.clientName].lines.push(r); });

      const existingByKey = Object.fromEntries(clients.map(c => [makeClientKey(c.name), c]));
      const importedKeys = new Set(Object.keys(grouped).map(makeClientKey));
      const importedClients = Object.values(grouped).map((g, i) => {
        const ex = existingByKey[makeClientKey(g.name)];
        const lead = resolveLead(g.name, g.lines[0]?.department || "", ex?.lead);
        return { id: ex?.id || `import-${i + 1}`, name: g.name, status: ex?.status || "active", lead, manual: false, lines: g.lines.map(l => ({ ...l, lead: l.lead || lead })) };
      });
      const manualOnly = clients.filter(c => c.manual && !importedKeys.has(makeClientKey(c.name)));
      const updatedClients = [...importedClients, ...manualOnly];
      const updatedApprovers = approverNames.length ? approverNames : approvers;
      const updatedApprovalKey = cols.find(c => c.h === effectiveApprovalKey) ? effectiveApprovalKey : importCtx.curKey;

      setRawRows(enriched); setClients(updatedClients); setApprovers(updatedApprovers);
      setMonthCols(cols); setCurColKey(importCtx.curKey); setApprovalMonthKey(updatedApprovalKey);
      setConnected(true); setShowImport(false); setClientPaste(""); setLeadPaste(""); setImportStep("clients");
      setAiMessages([{ role: "assistant", content: `Synced ${updatedClients.length} clients with ${enriched.length} service lines. Ask me anything!` }]);
      scheduleSave({ rawRows: enriched, clients: updatedClients, approvers: updatedApprovers, monthCols: cols, curColKey: importCtx.curKey, approvalMonthKey: updatedApprovalKey, connected: true });
    } catch (e) { setImportError(e.message); }
  }

  async function sendAI() {
    if (!aiInput.trim() || aiLoading) return;
    const msg = aiInput.trim(); setAiInput("");
    setAiMessages(p => [...p, { role: "user", content: msg }]); setAiLoading(true);
    const ctx = `Finance assistant for a service business.
CLIENTS: ${JSON.stringify(activeClients.map(c => ({ name: c.name, lead: c.lead, amount: c.amount, lastAmount: c.lastAmount })))}
BILLING MONTH: ${billingCtx.curLabel}, PREVIOUS: ${billingCtx.prevLabel}
TOTAL: ${fmt(totalProjected)}, PREVIOUS TOTAL: ${fmt(totalLast)}
Answer concisely in English, USD format.`;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: ctx, messages: [{ role: "user", content: msg }] }) });
      const d = await r.json();
      setAiMessages(p => [...p, { role: "assistant", content: d.content?.find(b => b.type === "text")?.text || "Could not process that." }]);
    } catch { setAiMessages(p => [...p, { role: "assistant", content: "Something went wrong." }]); }
    setAiLoading(false);
  }

  const tabs = ["dashboard", "clients", "invoices", "invoice approvals", "ai assistant"];

  if (storageLoading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400 text-sm">Loading data...</p></div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">InvoiceFlow</h1>
          <p className="text-xs text-gray-400">Service Business Dashboard</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SaveStatus state={saveStatus} />
          {monthCols.length > 0 && (
            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-400">Billing month:</span>
              <select value={billingCtx.curKey} onChange={e => { const k = e.target.value; setCurColKey(k); scheduleSave({ curColKey: k }); }} className="text-xs font-medium text-gray-700 outline-none bg-transparent">
                {monthCols.map(col => <option key={col.h} value={col.h}>{formatMonthLabel(col.d)}</option>)}
              </select>
            </div>
          )}
          {approvedCount > 0 && (
            <button onClick={() => {
              const rows = [["Client","Lead","Department","Service","Month","Amount"]];
              approvalInvoices.filter(i => i.status === "approved").forEach(inv => {
                const lines = inv.lines?.filter(l => (l.amounts[inv.monthCol] || 0) > 0) || [];
                if (!lines.length) rows.push([inv.clientName, inv.lead, "", "", inv.month, inv.amount]);
                else lines.forEach(l => rows.push([inv.clientName, inv.lead, l.department, l.service, inv.month, l.amounts[inv.monthCol]]));
              });
              const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
              const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `approved-${(approvalCtx.curLabel || "approvals").replace(" ", "-")}.csv`; a.click();
            }} className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700">Export Approved CSV</button>
          )}
          <button onClick={() => { setShowImport(true); setImportStep("clients"); setImportError(""); }} className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-900 bg-gray-900 text-white hover:bg-gray-700"}`}>
            {connected ? `Synced: ${clients.length} clients — Re-import` : "Import from Sheet"}
          </button>
          <button onClick={qboConnected ? undefined : () => { setQboSyncing(true); setTimeout(() => { setQboConnected(true); setQboSyncing(false); }, 1800); }} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${qboConnected ? "bg-emerald-50 text-emerald-700 cursor-default border border-emerald-200" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            {qboSyncing ? "Connecting..." : qboConnected ? "QBO Connected" : "Connect QuickBooks"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 px-6 overflow-x-auto">
        <div className="flex gap-6 min-w-max">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`py-3 text-sm font-medium border-b-2 transition-colors capitalize whitespace-nowrap ${tab === t ? "border-gray-900 text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
              {t === "invoice approvals" && pendingCount > 0 ? <span className="flex items-center gap-1.5">Invoice Approvals <span className="bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">{pendingCount}</span></span> : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {!connected && (
        <div className="max-w-6xl mx-auto px-6 pt-6">
          <div className="bg-blue-50 border border-blue-100 rounded-2xl px-6 py-4 text-sm text-blue-700 flex items-center justify-between">
            <span>Import your data from Google Sheets to get started.</span>
            <button onClick={() => setShowImport(true)} className="ml-4 bg-blue-700 text-white px-4 py-1.5 rounded-lg text-xs hover:bg-blue-800">Import now</button>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                { label: `Projected — ${billingCtx.curLabel || "selected"}`, value: fmt(totalProjected), sub: `${activeClients.length} active clients` },
                { label: `Previous — ${billingCtx.prevLabel || "previous"}`, value: fmt(totalLast), sub: "previous month" },
                { label: "Month-over-Month", value: (totalProjected - totalLast >= 0 ? "+" : "") + fmt(totalProjected - totalLast), sub: totalProjected >= totalLast ? "increase" : "decrease", color: totalProjected >= totalLast ? "text-emerald-600" : "text-red-500" },
                { label: "Pending Approval", value: pendingCount, sub: `${approvedCount} approved` },
              ].map(c => (
                <div key={c.label} className="bg-white rounded-2xl p-5 border border-gray-100">
                  <p className="text-xs text-gray-400 mb-1">{c.label}</p>
                  <p className={`text-2xl font-semibold ${c.color || "text-gray-900"}`}>{c.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{c.sub}</p>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <h2 className="font-medium text-gray-800">Month Comparison by Client</h2>
                <span className="text-xs text-gray-400">{billingCtx.prevLabel} → {billingCtx.curLabel}</span>
              </div>
              {!scopedClients.length ? <div className="px-6 py-10 text-center text-gray-300 text-sm">Import your data to see the comparison</div> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-400 border-b border-gray-50">
                    <th className="px-6 py-3 text-left">Client</th><th className="px-6 py-3 text-left">Lead</th><th className="px-6 py-3 text-left">Departments</th>
                    <th className="px-6 py-3 text-right">{billingCtx.prevLabel || "Previous"}</th><th className="px-6 py-3 text-right">{billingCtx.curLabel || "Projected"}</th>
                    <th className="px-6 py-3 text-right">Change</th><th className="px-6 py-3 text-left">Invoice</th>
                  </tr></thead>
                  <tbody>
                    {activeClients.filter(c => c.amount > 0 || c.lastAmount > 0).map(c => {
                      const diff = c.amount - c.lastAmount;
                      const inv = billingInvoices.find(i => i.clientId === c.id);
                      const depts = [...new Set(c.lines.map(l => l.department))].filter(Boolean);
                      return (
                        <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-6 py-3 font-medium text-gray-800">{c.name}</td>
                          <td className="px-6 py-3 text-xs text-gray-500">{c.lead || "—"}</td>
                          <td className="px-6 py-3"><div className="flex flex-wrap gap-1">{depts.map(d => <span key={d} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{d}</span>)}</div></td>
                          <td className="px-6 py-3 text-right text-gray-500">{fmt(c.lastAmount)}</td>
                          <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(c.amount)}</td>
                          <td className={`px-6 py-3 text-right font-medium ${diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>{diff >= 0 ? "+" : ""}{fmt(diff)}</td>
                          <td className="px-6 py-3">{inv && <Badge status={inv.status} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* CLIENTS */}
        {tab === "clients" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-medium text-gray-800">Clients ({activeClients.length} active · {rawRows.length} service lines)</h2>
              <div className="flex gap-2 items-center">
                {monthCols.length > 0 && (
                  <select value={billingCtx.curKey} onChange={e => { const k = e.target.value; setCurColKey(k); scheduleSave({ curColKey: k }); }} className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none text-gray-600">
                    {monthCols.map(col => <option key={col.h} value={col.h}>{formatMonthLabel(col.d)}</option>)}
                  </select>
                )}
                <button onClick={() => setShowAddClient(true)} className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700">+ Add Client</button>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2 text-xs text-blue-600">
              💡 Click any amount to edit it inline. Changes are saved automatically — watch for "✓ Saved" in the header.
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {!scopedClients.length ? <div className="px-6 py-10 text-center text-gray-300 text-sm">No clients — import your data</div> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-400 border-b border-gray-50">
                    <th className="px-6 py-3 text-left">Client</th><th className="px-6 py-3 text-left">Lead</th><th className="px-6 py-3 text-left">Services</th><th className="px-6 py-3 text-left">Departments</th>
                    <th className="px-6 py-3 text-right">{billingCtx.curLabel || "Current"}</th><th className="px-6 py-3 text-right">{billingCtx.nextLabel || "Next"}</th>
                    <th className="px-6 py-3 text-left">QBO Lines</th><th className="px-6 py-3 text-left">Status</th>
                  </tr></thead>
                  <tbody>
                    {scopedClients.map(c => {
                      const services = [...new Set(c.lines.map(l => l.service))].filter(Boolean);
                      const depts = [...new Set(c.lines.map(l => l.department))].filter(Boolean);
                      return (
                        <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-6 py-3 font-medium text-gray-800">{c.name}</td>
                          <td className="px-6 py-3 text-xs text-gray-500">{c.lead || "—"}</td>
                          <td className="px-6 py-3 text-gray-500 text-xs">{services.join(", ")}</td>
                          <td className="px-6 py-3"><div className="flex flex-wrap gap-1">{depts.map(d => <span key={d} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{d}</span>)}</div></td>
                          <td className="px-6 py-3 text-right"><EditableCell value={c.amount} onSave={v => updateAmount(c.id, "amount", v)} /></td>
                          <td className="px-6 py-3 text-right"><EditableCell value={c.nextAmount} onSave={v => updateAmount(c.id, "nextAmount", v)} /></td>
                          <td className="px-6 py-3 text-xs">{c.multiDept ? <span className="text-blue-600">{depts.length} lines</span> : <span className="text-gray-400">1 line</span>}</td>
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-2">
                              <Badge status={c.status} />
                              {c.status === "active" && <button onClick={() => archiveClient(c.id)} className="text-xs text-gray-300 hover:text-red-400">Archive</button>}
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

        {/* INVOICES */}
        {tab === "invoices" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-medium text-gray-800">Invoices — {billingCtx.curLabel || "this month"}</h2>
              {!qboConnected && <p className="text-xs text-amber-600 bg-amber-50 px-3 py-1 rounded-full">Connect QBO to enable auto-send</p>}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {!billingInvoices.length ? <div className="px-6 py-10 text-center text-gray-300 text-sm">No invoices — import your data first</div> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-400 border-b border-gray-50">
                    <th className="px-6 py-3 text-left">Client</th><th className="px-6 py-3 text-left">Lead</th><th className="px-6 py-3 text-right">Amount</th>
                    <th className="px-6 py-3 text-left">QBO Lines</th><th className="px-6 py-3 text-left">Approver</th><th className="px-6 py-3 text-left">Status</th><th className="px-6 py-3 text-left">Comment</th><th className="px-6 py-3"></th>
                  </tr></thead>
                  <tbody>
                    {billingInvoices.map(inv => {
                      const al = inv.lines?.filter(l => (l.amounts[inv.monthCol] || 0) > 0) || [];
                      return (
                        <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-6 py-3">
                            <div className="font-medium text-gray-800">{inv.clientName}</div>
                            {al.length > 0 && <button onClick={() => setShowInvoiceDetail(inv)} className="text-xs text-blue-500 hover:underline">View {al.length} line{al.length > 1 ? "s" : ""}</button>}
                          </td>
                          <td className="px-6 py-3 text-xs text-gray-500">{inv.lead || "—"}</td>
                          <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(inv.amount)}</td>
                          <td className="px-6 py-3 text-xs">{inv.multiDept ? <span className="text-blue-600">{[...new Set(inv.lines?.map(l => l.department))].filter(Boolean).length} sep.</span> : <span className="text-gray-400">1 line</span>}</td>
                          <td className="px-6 py-3 text-gray-500 text-xs">{inv.approver || "—"}</td>
                          <td className="px-6 py-3"><Badge status={inv.status} /></td>
                          <td className="px-6 py-3 text-gray-400 text-xs italic">{inv.comment || "—"}</td>
                          <td className="px-6 py-3 text-right">
                            <div className="flex gap-2 justify-end">
                              {inv.status === "pending" && <button onClick={() => { setShowApprove(inv); setApproveComment(inv.comment || ""); }} className="text-xs bg-gray-900 text-white px-3 py-1 rounded-lg hover:bg-gray-700">Review</button>}
                              {inv.status === "see notes" && <button onClick={() => { setShowApprove(inv); setApproveComment(inv.comment || ""); }} className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg hover:bg-orange-600">See Notes</button>}
                              {inv.status === "approved" && qboConnected && <button onClick={() => saveApprovalEntry(inv.approvalMonthKey, inv.clientName, { status: "sent", comment: inv.comment || "", approver: inv.approver || "" })} className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700">Send via QBO</button>}
                              {inv.status === "approved" && !qboConnected && <span className="text-xs text-gray-300">Connect QBO</span>}
                              {inv.status === "rejected" && <button onClick={() => saveApprovalEntry(inv.approvalMonthKey, inv.clientName, { status: "pending", comment: "", approver: inv.approver || "" })} className="text-xs text-amber-600 border border-amber-200 px-3 py-1 rounded-lg hover:bg-amber-50">Resubmit</button>}
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

        {/* INVOICE APPROVALS */}
        {tab === "invoice approvals" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="font-medium text-gray-800">Invoice Approvals</h2>
                <p className="text-xs text-gray-400 mt-0.5">{approvalCtx.curLabel || "Selected month"} vs previous ({approvalCtx.prevLabel || "—"})</p>
              </div>
              <div className="flex flex-col gap-2 items-end">
                <div className="flex gap-2 flex-wrap justify-end items-center">
                  {monthCols.length > 0 && (
                    <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <span className="text-xs text-gray-400">Approval month:</span>
                      <select value={effectiveApprovalKey} onChange={e => { const k = e.target.value; setApprovalMonthKey(k); setFilterLead("all"); setFilterStatus("all"); scheduleSave({ approvalMonthKey: k }); }} className="text-xs font-medium text-gray-700 outline-none bg-transparent">
                        {monthCols.map(col => <option key={col.h} value={col.h}>{formatMonthLabel(col.d)}</option>)}
                      </select>
                    </div>
                  )}
                  <button onClick={resetApprovalsForMonth} className="px-3 py-2 rounded-lg text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50">Clear approvals for this month</button>
                </div>
                <div className="flex gap-1 flex-wrap justify-end">
                  {["all", ...new Set(approvalBase.map(i => i.lead).filter(Boolean))].map(l => (
                    <button key={l} onClick={() => setFilterLead(l)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${filterLead === l ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                      {l === "all" ? "All leads" : l}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 flex-wrap justify-end">
                  {["all","pending","approved","see notes","rejected","sent"].map(s => {
                    const colors = { all:"bg-gray-900 text-white", pending:"bg-amber-500 text-white", approved:"bg-blue-600 text-white", "see notes":"bg-orange-500 text-white", rejected:"bg-red-500 text-white", sent:"bg-purple-600 text-white" };
                    return <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${filterStatus === s ? colors[s] : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{s === "all" ? "All statuses" : s}</button>;
                  })}
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-full">{filteredApprovals.filter(i => i.status === "pending").length} pending</span>
                  <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full">{filteredApprovals.filter(i => i.status === "approved").length} approved</span>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {!filteredApprovals.length ? <div className="px-6 py-10 text-center text-gray-300 text-sm">{!approvalInvoices.length ? "No invoices — import your data first" : "No invoices for this filter"}</div> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-400 border-b border-gray-50">
                    <th className="px-6 py-3 text-left">Client</th><th className="px-6 py-3 text-left">Lead</th><th className="px-6 py-3 text-left">Departments</th>
                    <th className="px-6 py-3 text-right">{approvalCtx.prevLabel || "Previous"}</th><th className="px-6 py-3 text-right">{approvalCtx.curLabel || "Projected"}</th>
                    <th className="px-6 py-3 text-right">Change</th><th className="px-6 py-3 text-left">Status</th><th className="px-6 py-3 text-left">Comment</th><th className="px-6 py-3"></th>
                  </tr></thead>
                  <tbody>
                    {filteredApprovals.map(inv => {
                      const diff = inv.amount - inv.lastAmount;
                      const al = inv.lines?.filter(l => (l.amounts[inv.monthCol] || 0) > 0) || [];
                      const depts = [...new Set(inv.lines?.map(l => l.department).filter(Boolean))];
                      return (
                        <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-6 py-3">
                            <div className="font-medium text-gray-800">{inv.clientName}</div>
                            {al.length > 0 && <button onClick={() => setShowInvoiceDetail({ ...inv, month: approvalCtx.curLabel, amount: inv.amount })} className="text-xs text-blue-500 hover:underline">View {al.length} line{al.length > 1 ? "s" : ""}</button>}
                          </td>
                          <td className="px-6 py-3 text-xs text-gray-500">{inv.lead || "—"}</td>
                          <td className="px-6 py-3"><div className="flex flex-wrap gap-1">{depts.map(d => <span key={d} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{d}</span>)}</div></td>
                          <td className="px-6 py-3 text-right text-gray-500">{fmt(inv.lastAmount)}</td>
                          <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(inv.amount)}</td>
                          <td className={`px-6 py-3 text-right font-medium ${diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>{diff >= 0 ? "+" : ""}{fmt(diff)}</td>
                          <td className="px-6 py-3"><Badge status={inv.status} /></td>
                          <td className="px-6 py-3 text-gray-400 text-xs italic">{inv.comment || "—"}</td>
                          <td className="px-6 py-3 text-right">
                            <div className="flex gap-2 justify-end">
                              {inv.status === "pending" && <button onClick={() => { setShowApprove(inv); setApproveComment(inv.comment || ""); }} className="text-xs bg-gray-900 text-white px-3 py-1 rounded-lg hover:bg-gray-700">Review</button>}
                              {inv.status === "see notes" && <button onClick={() => { setShowApprove(inv); setApproveComment(inv.comment || ""); }} className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg hover:bg-orange-600">See Notes</button>}
                              {inv.status === "approved" && qboConnected && <button onClick={() => saveApprovalEntry(inv.approvalMonthKey, inv.clientName, { status: "sent", comment: inv.comment || "", approver: inv.approver || "" })} className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700">Send via QBO</button>}
                              {inv.status === "approved" && !qboConnected && <span className="text-xs text-gray-300">Connect QBO</span>}
                              {inv.status === "rejected" && <button onClick={() => saveApprovalEntry(inv.approvalMonthKey, inv.clientName, { status: "pending", comment: "", approver: inv.approver || "" })} className="text-xs text-amber-600 border border-amber-200 px-3 py-1 rounded-lg hover:bg-amber-50">Resubmit</button>}
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

        {/* AI */}
        {tab === "ai assistant" && (
          <div className="bg-white rounded-2xl border border-gray-100 flex flex-col" style={{ height: "520px" }}>
            <div className="px-6 py-4 border-b border-gray-50">
              <h2 className="font-medium text-gray-800">AI Finance Assistant</h2>
              <p className="text-xs text-gray-400">Ask anything about your clients, invoices, or monthly performance</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {aiMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-xs md:max-w-md px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800"}`}>{m.content}</div>
                </div>
              ))}
              {aiLoading && <div className="flex justify-start"><div className="bg-gray-100 text-gray-400 px-4 py-2.5 rounded-2xl text-sm">Thinking...</div></div>}
              <div ref={chatEndRef} />
            </div>
            <div className="px-6 py-4 border-t border-gray-50 flex gap-3">
              <input value={aiInput} onChange={e => setAiInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendAI()} placeholder="e.g. Which clients have more than one department?" className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-gray-400" />
              <button onClick={sendAI} disabled={aiLoading} className="bg-gray-900 text-white px-4 py-2 rounded-xl text-sm hover:bg-gray-700 disabled:opacity-40">Send</button>
            </div>
          </div>
        )}
      </div>

      {/* IMPORT */}
      {showImport && (
        <Modal title="Import from Google Sheets" onClose={() => setShowImport(false)} wide>
          <div className="space-y-4">
            <div className="flex rounded-xl overflow-hidden border border-gray-100">
              {["clients","leads"].map((s, i) => <button key={s} onClick={() => setImportStep(s)} className={`flex-1 py-2 text-sm font-medium ${importStep === s ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}>{i + 1}. {s === "clients" ? "Forecasted Revenues" : "Leads (team)"}</button>)}
            </div>
            {importStep === "clients" && (
              <div className="space-y-3">
                <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                  <p className="font-medium">How to copy:</p>
                  <p>1. Open <strong>Forecasted Revenues</strong> tab → click <strong>D1</strong></p>
                  <p>2. Select to last column and row with data</p>
                  <p>3. Copy (Ctrl+C / Cmd+C) and paste below</p>
                  <p className="text-blue-500">✓ Manual clients and all approval history are preserved on re-import.</p>
                </div>
                <textarea value={clientPaste} onChange={e => setClientPaste(e.target.value)} placeholder={"Client Name\tService\tDepartment\t01/01/2025\t02/01/2025\nAcme Corp\tPaid\tCore Growth\t4500\t5000"} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono outline-none focus:border-gray-400 resize-none" rows={9} />
                <button onClick={() => setImportStep("leads")} disabled={!clientPaste.trim()} className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">Next: Paste team data</button>
              </div>
            )}
            {importStep === "leads" && (
              <div className="space-y-3">
                <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                  <p className="font-medium">How to copy your team:</p>
                  <p>1. Open <strong>Leads</strong> tab → select all including headers</p>
                  <p>2. Copy and paste below</p>
                </div>
                <textarea value={leadPaste} onChange={e => setLeadPaste(e.target.value)} placeholder={"Client\tLead\nAcme Corp\tSarah Johnson"} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono outline-none focus:border-gray-400 resize-none" rows={6} />
                {importError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{importError}</p>}
                <div className="flex gap-3">
                  <button onClick={() => setImportStep("clients")} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Back</button>
                  <button onClick={processImport} disabled={!clientPaste.trim()} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">Import data</button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ADD CLIENT */}
      {showAddClient && (
        <Modal title="Add New Client" onClose={() => setShowAddClient(false)}>
          <div className="space-y-3">
            <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700">Added manually — won't affect your Google Sheet. Preserved on re-import.</div>
            {[["Client Name *","name","text"],["Service","service","text"],["Department","department","text"],["Lead","lead","text"]].map(([label, key, type]) => (
              <div key={key}>
                <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                <input type={type} value={newClient[key]} onChange={e => setNewClient(p => ({ ...p, [key]: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400" />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{billingCtx.curLabel || "Current"} ($)</label>
                <input type="number" value={newClient.currentAmt} onChange={e => setNewClient(p => ({ ...p, currentAmt: e.target.value }))} placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{billingCtx.nextLabel || "Next"} ($)</label>
                <input type="number" value={newClient.nextAmt} onChange={e => setNewClient(p => ({ ...p, nextAmt: e.target.value }))} placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowAddClient(false); setNewClient({ name:"", service:"", department:"", lead:"", currentAmt:"", nextAmt:"" }); }} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={addClientManually} disabled={!newClient.name.trim()} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">Add Client</button>
            </div>
          </div>
        </Modal>
      )}

      {/* INVOICE DETAIL */}
      {showInvoiceDetail && (
        <Modal title={`Invoice lines — ${showInvoiceDetail.clientName}`} onClose={() => setShowInvoiceDetail(null)} wide>
          <div className="space-y-3">
            <p className="text-xs text-gray-400">Month: {showInvoiceDetail.month} · {showInvoiceDetail.multiDept ? "Separate QBO lines" : "Single QBO line"}</p>
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-400 border-b border-gray-100"><th className="py-2 text-left">Service</th><th className="py-2 text-left">Department</th><th className="py-2 text-left">Lead</th><th className="py-2 text-right">Amount</th></tr></thead>
              <tbody>
                {showInvoiceDetail.lines?.filter(l => (l.amounts[showInvoiceDetail.monthCol] || 0) > 0).map((l, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-700">{l.service}</td>
                    <td className="py-2"><span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{l.department}</span></td>
                    <td className="py-2 text-xs text-gray-500">{l.lead || "—"}</td>
                    <td className="py-2 text-right font-medium text-gray-800">{fmt(l.amounts[showInvoiceDetail.monthCol])}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3} className="pt-3 text-sm font-medium text-gray-600">Total</td><td className="pt-3 text-right font-semibold text-gray-900">{fmt(showInvoiceDetail.amount)}</td></tr></tfoot>
            </table>
            <button onClick={() => setShowInvoiceDetail(null)} className="w-full border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Close</button>
          </div>
        </Modal>
      )}

      {/* APPROVE */}
      {showApprove && (
        <Modal title={`Review Invoice — ${showApprove.clientName}`} onClose={() => setShowApprove(null)}>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between"><span className="text-gray-500">Client</span><span className="font-medium">{showApprove.clientName}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Lead</span><span>{showApprove.lead || "—"}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Previous month</span><span>{fmt(showApprove.lastAmount)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Projected month</span><span className="font-semibold">{fmt(showApprove.amount)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">QBO lines</span><span>{showApprove.multiDept ? `${[...new Set(showApprove.lines?.map(l => l.department))].filter(Boolean).length} separate` : "1 line"}</span></div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Approver</label>
              <select value={showApprove.approver} onChange={e => setShowApprove(p => ({ ...p, approver: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none">
                {(approvers.length ? approvers : ["—"]).map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Comment (optional)</label>
              <textarea value={approveComment} onChange={e => setApproveComment(e.target.value)} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none resize-none focus:border-gray-400" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => approveInvoice("rejected")} className="flex-1 border border-red-200 text-red-600 rounded-lg py-2 text-sm hover:bg-red-50">Reject</button>
              <button onClick={() => approveInvoice("see notes")} className="flex-1 border border-orange-200 text-orange-600 rounded-lg py-2 text-sm hover:bg-orange-50">See Notes</button>
              <button onClick={() => approveInvoice("approved")} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700">Approve</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

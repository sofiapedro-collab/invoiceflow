import { useState, useRef, useEffect } from "react";

const SUPABASE_URL = "https://hpycqegogkqsodvykqfj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhweWNxZWdvZ2txc29kdnlrcWZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTUxMTcsImV4cCI6MjA4OTUzMTExN30.Rb5r_9gsNNVIl0e9dqYraYJdDayvunqEMfQ_I8FmfKI";

async function loadFromSupabase() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/invoiceflow_data?id=eq.main&select=data`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const rows = await res.json();
  return rows?.[0]?.data || null;
}

async function saveToSupabase(data) {
  await fetch(`${SUPABASE_URL}/rest/v1/invoiceflow_data?id=eq.main`, {
    method: "PATCH",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data, updated_at: new Date().toISOString() })
  });
}

function fmt(n) { return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2 }); }
const DEPT_DEFAULT_LEADS = { "fiat finance": "Kaley", "uncovered": "Nick" };
function getDefaultLead(d) { return DEPT_DEFAULT_LEADS[d?.toLowerCase().trim()] || ""; }

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

// Inline editable amount cell
function EditableCell({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const ref = useRef();
  function start() { setVal(String(value || 0)); setEditing(true); setTimeout(() => ref.current?.select(), 30); }
  function save() { const n = parseFloat(String(val).replace(/[$,]/g, "")) || 0; onSave(n); setEditing(false); }
  if (editing) return (
    <input ref={ref} value={val} onChange={e => setVal(e.target.value)}
      onBlur={save} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
      className="w-24 border border-blue-300 rounded px-2 py-0.5 text-right text-xs outline-none bg-blue-50" />
  );
  return (
    <span onClick={start} title="Click to edit"
      className="cursor-pointer hover:bg-blue-50 hover:text-blue-700 px-1 py-0.5 rounded transition-colors font-medium text-gray-800">
      {fmt(value)}
    </span>
  );
}

function DroppedClients({ clients, currentMonthLabel, nextMonthLabel }) {
  const dropped = clients.filter(c => c.amount > 0 && c.nextAmount === 0);
  if (!dropped.length) return null;
  return (
    <div className="bg-white rounded-2xl border border-red-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-red-50 flex items-center justify-between">
        <h2 className="font-medium text-red-700">No billing next month</h2>
        <span className="text-xs text-red-400">{dropped.length} client{dropped.length > 1 ? "s" : ""} had billing this month but not next</span>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-400 border-b border-gray-50">
          <th className="px-6 py-3 text-left">Client</th>
          <th className="px-6 py-3 text-left">Lead</th>
          <th className="px-6 py-3 text-left">Departments</th>
          <th className="px-6 py-3 text-right">{currentMonthLabel}</th>
          <th className="px-6 py-3 text-right">{nextMonthLabel || "Next Month"}</th>
        </tr></thead>
        <tbody>
          {dropped.map(c => {
            const depts = [...new Set(c.lines.map(l => l.department))].filter(Boolean);
            return (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-red-50 transition-colors">
                <td className="px-6 py-3 font-medium text-gray-800">{c.name}</td>
                <td className="px-6 py-3 text-xs text-gray-500">{c.lead || "—"}</td>
                <td className="px-6 py-3"><div className="flex flex-wrap gap-1">{depts.map(d => <span key={d} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{d}</span>)}</div></td>
                <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(c.amount)}</td>
                <td className="px-6 py-3 text-right text-red-500 font-medium">$0.00</td>
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
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  m = h.match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (m) { const mo = months.indexOf(m[1].toLowerCase()); if (mo >= 0) return new Date(Number(m[2]), mo, 1); }
  return null;
}
function formatMonthLabel(d) {
  if (!d || !(d instanceof Date) || isNaN(d)) return "";
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}
function labelFromKey(key) {
  if (!key) return "";
  const d = parseColDate(key);
  return d ? formatMonthLabel(d) : key;
}
function nextLabelFromKey(key, cols) {
  if (!key || !cols?.length) return "";
  const idx = cols.findIndex(c => c.h === key);
  if (idx < 0 || idx >= cols.length - 1) return "";
  return labelFromKey(cols[idx + 1].h);
}
function parsePaste(text) { return text.trim().split("\n").map(r => r.split("\t").map(c => c.trim())); }
function rowsToObjects(rows) {
  if (rows.length < 2) return { objects: [], headers: [] };
  const headers = rows[0];
  const objects = rows.slice(1).filter(r => r.some(c => c)).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])));
  return { objects, headers };
}
function parseAmount(val) { if (!val) return 0; return parseFloat(String(val).replace(/[$,\s]/g, "")) || 0; }
function getMonthCols(headers) {
  return headers.map((h, i) => ({ h, i, d: parseColDate(h) })).filter(x => x.d).sort((a, b) => a.d - b.d);
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
  const [invoices, setInvoices] = useState([]);
  const [monthCols, setMonthCols] = useState([]);
  const [currentMonthLabel, setCurrentMonthLabel] = useState("");
  const [lastMonthLabel, setLastMonthLabel] = useState("");
  const [nextMonthLabel, setNextMonthLabel] = useState("");
  const [connected, setConnected] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [curColKey, setCurColKey] = useState("");
  const [nextColKey, setNextColKey] = useState("");

  const [showApprove, setShowApprove] = useState(null);
  const [showInvoiceDetail, setShowInvoiceDetail] = useState(null);
  const [approveComment, setApproveComment] = useState("");
  const [qboConnected, setQboConnected] = useState(false);
  const [qboSyncing, setQboSyncing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [aiMessages, setAiMessages] = useState([{ role: "assistant", content: "Hi! Import your data from Google Sheets and then ask me anything about your clients, invoices, or monthly performance." }]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const chatEndRef = useRef(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [aiMessages]);

  useEffect(() => {
    async function load() {
      try {
        const d = await loadFromSupabase();
        if (d?.clients?.length) {
          setRawRows(d.rawRows || []); setClients(d.clients || []); setApprovers(d.approvers || []);
          setInvoices(d.invoices || []); setMonthCols(d.monthCols || []);
          setCurrentMonthLabel(d.currentMonthLabel || ""); setLastMonthLabel(d.lastMonthLabel || "");
          setNextMonthLabel(d.nextMonthLabel || ""); setSelectedMonth(d.selectedMonth || "");
          setCurColKey(d.curColKey || ""); setNextColKey(d.nextColKey || "");
          setConnected(true);
          setAiMessages([{ role: "assistant", content: `Data loaded: ${(d.clients || []).length} clients. Ask me anything!` }]);
        }
      } catch (_) {}
      setStorageLoading(false);
    }
    load();
  }, []);

  async function persistAll(newClients, newInvoices) {
    setSaving(true);
    try {
      const saved = await loadFromSupabase();
      const base = saved || {};
      await saveToSupabase({
        ...base,
        clients: newClients,
        invoices: newInvoices,
        rawRows: base.rawRows || rawRows,
        approvers: base.approvers || approvers,
        monthCols: base.monthCols || monthCols,
        curColKey: base.curColKey || curColKey,
        nextColKey: base.nextColKey || nextColKey,
        currentMonthLabel: base.currentMonthLabel || currentMonthLabel,
        lastMonthLabel: base.lastMonthLabel || lastMonthLabel,
        nextMonthLabel: base.nextMonthLabel || nextMonthLabel,
        selectedMonth: base.selectedMonth || selectedMonth,
      });
    } catch (_) {}
    setSaving(false);
  }

  // Edit amount inline — updates both client and invoice, saves to Supabase
  async function updateAmount(clientId, field, newVal) {
    const updatedClients = clients.map(c => c.id === clientId ? { ...c, [field]: newVal } : c);
    const updatedInvoices = invoices.map(inv => {
      if (inv.clientId !== clientId) return inv;
      return { ...inv, amount: field === "amount" ? newVal : inv.amount, nextAmount: field === "nextAmount" ? newVal : inv.nextAmount };
    });
    setClients(updatedClients);
    setInvoices(updatedInvoices);
    await persistAll(updatedClients, updatedInvoices);
  }

  // Add client manually without reimporting
  async function addClientManually() {
    if (!newClient.name.trim()) return;
    const id = Date.now();
    const curAmt = parseFloat(newClient.currentAmt) || 0;
    const nextAmt = parseFloat(newClient.nextAmt) || 0;
    const lead = newClient.lead.trim() || getDefaultLead(newClient.department) || "";
    const line = { _id: id, clientName: newClient.name.trim(), service: newClient.service, department: newClient.department, lead, amounts: { [curColKey]: curAmt, [nextColKey]: nextAmt } };
    const newC = { id, name: newClient.name.trim(), status: "active", lines: [line], lead, amount: curAmt, lastAmount: 0, nextAmount: nextAmt, multiDept: false };
    const newInv = {
      id, clientId: id, clientName: newC.name, amount: curAmt, lastAmount: 0, nextAmount: nextAmt,
      approver: approvers[0] || "", lead, status: "pending", comment: "",
      month: currentMonthLabel, monthCol: curColKey, nextMonthCol: nextColKey,
      lines: [line], multiDept: false,
    };
    const updatedClients = [...clients, newC];
    const updatedInvoices = [...invoices, newInv];
    setClients(updatedClients);
    setInvoices(updatedInvoices);
    setShowAddClient(false);
    setNewClient({ name: "", service: "", department: "", lead: "", currentAmt: "", nextAmt: "" });
    await persistAll(updatedClients, updatedInvoices);
  }

  async function processImport() {
    setImportError("");
    try {
      const clientRows = parsePaste(clientPaste);
      const { objects, headers } = rowsToObjects(clientRows);
      if (!objects.length) throw new Error("No data found. Make sure to include the header row.");
      const cols = getMonthCols(headers);
      if (!cols.length) throw new Error("No month columns found. Expected format: 01/01/2025 or Jan 2025.");

      // Use manually selected billing month if set, otherwise fall back to last col
      const savedCurKey = curColKey;
      let curCol = (savedCurKey && cols.find(c => c.h === savedCurKey)) || cols[cols.length - 2] || cols[cols.length - 1];
      const curIdx = cols.indexOf(curCol);
      const prevCol = curIdx > 0 ? cols[curIdx - 1] : null;
      const nextCol = curIdx < cols.length - 1 ? cols[curIdx + 1] : null;

      const curLabel = formatMonthLabel(curCol.d);
      const prevLabel = prevCol ? formatMonthLabel(prevCol.d) : "";
      const nextLabel = nextCol ? formatMonthLabel(nextCol.d) : "";

      const nameKey = headers.find(h => /client.*name|^client$/i.test(h));
      const serviceKey = headers.find(h => /^service$/i.test(h));
      const deptKey = headers.find(h => /department|dept/i.test(h));
      if (!nameKey) throw new Error("Could not find a 'Client Name' column.");

      let leadMap = {}, approverNames = [];
      if (leadPaste.trim()) {
        const leadRows = parsePaste(leadPaste);
        const { objects: lo, headers: lh } = rowsToObjects(leadRows);
        const clientCol = lh.find(h => /^client$/i.test(h)) || lh[0];
        const leadCol = lh.find(h => /^lead$/i.test(h)) || lh[1];
        lo.forEach(r => { const cn = r[clientCol]?.trim(); const ln = r[leadCol]?.trim(); if (cn && ln) leadMap[cn.toLowerCase()] = ln; });
        approverNames = [...new Set(lo.map(r => r[leadCol]).filter(Boolean))];
      }

      const resolveLead = (name, dept) => leadMap[name?.toLowerCase()] || getDefaultLead(dept) || "";
      const enriched = objects.filter(r => r[nameKey]?.trim()).map((r, i) => {
        const dept = deptKey ? (r[deptKey] || "") : "";
        return { _id: i, clientName: r[nameKey].trim(), service: serviceKey ? (r[serviceKey] || "") : "", department: dept, lead: resolveLead(r[nameKey].trim(), dept), amounts: Object.fromEntries(cols.map(c => [c.h, parseAmount(r[c.h])])) };
      });

      const grouped = {};
      enriched.forEach(r => { if (!grouped[r.clientName]) grouped[r.clientName] = { name: r.clientName, lines: [] }; grouped[r.clientName].lines.push(r); });

      const clientList = Object.values(grouped).map((g, i) => ({
        id: i + 1, name: g.name, status: "active", lines: g.lines,
        lead: g.lines.find(l => l.lead)?.lead || "",
        amount: g.lines.reduce((s, l) => s + (l.amounts[curCol.h] || 0), 0),
        lastAmount: g.lines.reduce((s, l) => s + (l.amounts[prevCol ? prevCol.h : ""] || 0), 0),
        nextAmount: g.lines.reduce((s, l) => s + (l.amounts[nextCol ? nextCol.h : ""] || 0), 0),
        multiDept: new Set(g.lines.map(l => l.department).filter(Boolean)).size > 1,
      }));

      // Preserve existing statuses — never overwrite non-pending statuses
      const invoiceList = clientList.map((c, i) => {
        const existing = invoices.find(p => p.clientName === c.name);
        const preserveStatus = existing && existing.status !== "pending";
        return {
          id: i + 1, clientId: c.id, clientName: c.name,
          amount: c.amount, lastAmount: c.lastAmount, nextAmount: c.nextAmount,
          approver: existing?.approver || approverNames[0] || "", lead: c.lead,
          status: preserveStatus ? existing.status : (existing?.status || "pending"),
          comment: existing?.comment || "",
          month: curLabel, monthCol: curCol.h, nextMonthCol: nextCol?.h || "",
          lines: c.lines, multiDept: c.multiDept,
        };
      });

      setRawRows(enriched); setClients(clientList); setApprovers(approverNames);
      setInvoices(invoiceList); setMonthCols(cols);
      setCurrentMonthLabel(curLabel); setLastMonthLabel(prevLabel); setNextMonthLabel(nextLabel);
      setSelectedMonth(curCol.h); setCurColKey(curCol.h); setNextColKey(nextCol?.h || "");
      setConnected(true);
      setShowImport(false); setClientPaste(""); setLeadPaste(""); setImportStep("clients");
      setAiMessages([{ role: "assistant", content: `Synced ${clientList.length} clients with ${enriched.length} service lines. Ask me anything!` }]);

      setSaving(true);
      try { await saveToSupabase({ rawRows: enriched, clients: clientList, approvers: approverNames, invoices: invoiceList, monthCols: cols, currentMonthLabel: curLabel, lastMonthLabel: prevLabel, nextMonthLabel: nextLabel, selectedMonth: curCol.h, curColKey: curCol.h, nextColKey: nextCol?.h || "" }); } catch (_) {}
      setSaving(false);
    } catch (e) { setImportError(e.message); }
  }

  async function approveInvoice(decision) {
    const updated = invoices.map(i => i.id === showApprove.id ? { ...i, status: decision, comment: approveComment } : i);
    setInvoices(updated); setApproveComment(""); setShowApprove(null);
    const saved = await loadFromSupabase();
    if (saved) await saveToSupabase({ ...saved, invoices: updated });
  }

  async function handleSaveInvoices(updated) {
    const saved = await loadFromSupabase();
    if (saved) await saveToSupabase({ ...saved, invoices: updated });
  }

  const activeClients = clients.filter(c => c.status === "active");
  const totalProjected = activeClients.reduce((s, c) => s + c.amount, 0);
  const totalLast = activeClients.reduce((s, c) => s + c.lastAmount, 0);
  const totalNext = activeClients.reduce((s, c) => s + c.nextAmount, 0);
  const pendingCount = invoices.filter(i => i.status === "pending" && i.nextAmount > 0).length;
  const approvedCount = invoices.filter(i => i.status === "approved").length;

  // Invoice approvals filtered
  const [filterLead, setFilterLead] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const approvalBase = invoices.filter(i => i.nextAmount > 0);
  const approvalLeads = ["all", ...new Set(approvalBase.map(i => i.lead).filter(Boolean))];
  const approvalStatuses = ["all", "pending", "approved", "see notes", "rejected", "sent"];
  const filteredApprovals = approvalBase
    .filter(i => filterLead === "all" || i.lead === filterLead)
    .filter(i => filterStatus === "all" || i.status === filterStatus);

  async function sendAI() {
    if (!aiInput.trim() || aiLoading) return;
    const userMsg = aiInput.trim(); setAiInput("");
    setAiMessages(p => [...p, { role: "user", content: userMsg }]);
    setAiLoading(true);
    const ctx = `You are a finance assistant for a service business agency.
CLIENTS: ${JSON.stringify(clients.map(c => ({ name: c.name, lead: c.lead, amount: c.amount, nextAmount: c.nextAmount })))}
INVOICES: ${JSON.stringify(invoices.map(i => ({ client: i.clientName, lead: i.lead, amount: i.amount, status: i.status })))}
CURRENT MONTH: ${currentMonthLabel}, LAST MONTH: ${lastMonthLabel}, NEXT MONTH: ${nextMonthLabel}
TOTAL THIS MONTH: ${fmt(totalProjected)}, TOTAL NEXT MONTH: ${fmt(totalNext)}
Answer concisely in English. Use USD formatting.`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: ctx, messages: [{ role: "user", content: userMsg }] }),
      });
      const data = await res.json();
      const reply = data.content?.find(b => b.type === "text")?.text || "Could not process that.";
      setAiMessages(p => [...p, { role: "assistant", content: reply }]);
    } catch { setAiMessages(p => [...p, { role: "assistant", content: "Something went wrong. Please try again." }]); }
    setAiLoading(false);
  }

  const tabs = ["dashboard", "clients", "invoices", "invoice approvals", "ai assistant"];

  if (storageLoading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">Loading data...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">InvoiceFlow</h1>
          <p className="text-xs text-gray-400">Service Business Dashboard</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {saving && <span className="text-xs text-gray-400">Saving...</span>}
          {monthCols.length > 0 && (
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-400">Billing month:</span>
              <select value={curColKey} onChange={async e => {
                const newKey = e.target.value;
                const cols = monthCols;
                const idx = cols.findIndex(c => c.h === newKey);
                const cur = cols[idx];
                const prev = idx > 0 ? cols[idx - 1] : null;
                const next = idx < cols.length - 1 ? cols[idx + 1] : null;
                const curLabel = formatMonthLabel(cur.d);
                const prevLabel = prev ? formatMonthLabel(prev.d) : "";
                const nextLabel = next ? formatMonthLabel(next.d) : "";
                setCurColKey(newKey);
                setNextColKey(next?.h || "");
                setCurrentMonthLabel(curLabel);
                setLastMonthLabel(prevLabel);
                setNextMonthLabel(nextLabel);
                setSelectedMonth(newKey);
                // Update invoice month references without touching statuses
                const updatedInvoices = invoices.map(inv => ({
                  ...inv, month: curLabel, monthCol: newKey, nextMonthCol: next?.h || "",
                  amount: clients.find(c => c.id === inv.clientId)?.lines?.reduce((s, l) => s + (l.amounts[newKey] || 0), 0) ?? inv.amount,
                  nextAmount: clients.find(c => c.id === inv.clientId)?.lines?.reduce((s, l) => s + (l.amounts[next?.h || ""] || 0), 0) ?? inv.nextAmount,
                }));
                const updatedClients = clients.map(c => ({
                  ...c,
                  amount: c.lines?.reduce((s, l) => s + (l.amounts[newKey] || 0), 0) ?? c.amount,
                  nextAmount: c.lines?.reduce((s, l) => s + (l.amounts[next?.h || ""] || 0), 0) ?? c.nextAmount,
                  lastAmount: c.lines?.reduce((s, l) => s + (l.amounts[prev?.h || ""] || 0), 0) ?? c.lastAmount,
                }));
                setInvoices(updatedInvoices);
                setClients(updatedClients);
                const saved = await loadFromSupabase();
                if (saved) await saveToSupabase({ ...saved, invoices: updatedInvoices, clients: updatedClients, curColKey: newKey, nextColKey: next?.h || "", currentMonthLabel: curLabel, lastMonthLabel: prevLabel, nextMonthLabel: nextLabel, selectedMonth: newKey });
              }} className="text-xs font-medium text-gray-700 outline-none bg-transparent">
                {monthCols.map(c => { const d = parseColDate(c.h); return <option key={c.h} value={c.h}>{d ? formatMonthLabel(d) : c.h}</option>; })}
              </select>
            </div>
          )}
          {approvedCount > 0 && (
            <button onClick={() => {
              const approved = invoices.filter(i => i.status === "approved");
              const rows = [["Client","Lead","Department","Service","Month","Amount"]];
              approved.forEach(inv => {
                const lines = inv.lines?.filter(l => (l.amounts[inv.monthCol] || 0) > 0) || [];
                if (!lines.length) rows.push([inv.clientName, inv.lead, "", "", inv.month, inv.amount]);
                else lines.forEach(l => rows.push([inv.clientName, inv.lead, l.department, l.service, inv.month, l.amounts[inv.monthCol]]));
              });
              const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
              const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
              a.download = `approved-${currentMonthLabel.replace(" ","-")}.csv`; a.click();
            }} className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
              Export Approved CSV
            </button>
          )}
          <button onClick={() => { setShowImport(true); setImportStep("clients"); setImportError(""); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-900 bg-gray-900 text-white hover:bg-gray-700"}`}>
            {connected ? `Synced: ${clients.length} clients — Re-import` : "Import from Sheet"}
          </button>
          <button onClick={qboConnected ? undefined : () => { setQboSyncing(true); setTimeout(() => { setQboConnected(true); setQboSyncing(false); }, 1800); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${qboConnected ? "bg-emerald-50 text-emerald-700 cursor-default border border-emerald-200" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            {qboSyncing ? "Connecting..." : qboConnected ? "QBO Connected" : "Connect QuickBooks"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 px-6 overflow-x-auto">
        <div className="flex gap-6 min-w-max">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors capitalize whitespace-nowrap ${tab === t ? "border-gray-900 text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
              {t === "invoice approvals" && pendingCount > 0
                ? <span className="flex items-center gap-1.5">Invoice Approvals <span className="bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">{pendingCount}</span></span>
                : t.charAt(0).toUpperCase() + t.slice(1)}
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
                { label: `Projected — ${nextMonthLabel || "next month"}`, value: fmt(totalNext), sub: `${activeClients.length} active clients` },
                { label: `Invoiced — ${currentMonthLabel || "this month"}`, value: fmt(totalProjected), sub: "current month" },
                { label: "Month-over-Month", value: (totalNext - totalProjected >= 0 ? "+" : "") + fmt(totalNext - totalProjected), sub: totalNext >= totalProjected ? "increase" : "decrease", color: totalNext >= totalProjected ? "text-emerald-600" : "text-red-500" },
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
                <span className="text-xs text-gray-400">{currentMonthLabel} vs {nextMonthLabel}</span>
              </div>
              {clients.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-300 text-sm">Import your data to see the comparison</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-400 border-b border-gray-50">
                    <th className="px-6 py-3 text-left">Client</th>
                    <th className="px-6 py-3 text-left">Lead</th>
                    <th className="px-6 py-3 text-left">Departments</th>
                    <th className="px-6 py-3 text-right">{currentMonthLabel}</th>
                    <th className="px-6 py-3 text-right">{nextMonthLabel}</th>
                    <th className="px-6 py-3 text-right">Change</th>
                    <th className="px-6 py-3 text-left">Invoice</th>
                  </tr></thead>
                  <tbody>
                    {activeClients.filter(c => c.amount > 0 || c.nextAmount > 0).map(c => {
                      const diff = c.nextAmount - c.amount;
                      const inv = invoices.find(i => i.clientId === c.id);
                      const depts = [...new Set(c.lines.map(l => l.department))].filter(Boolean);
                      return (
                        <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-3 font-medium text-gray-800">{c.name}</td>
                          <td className="px-6 py-3 text-xs text-gray-500">{c.lead || "—"}</td>
                          <td className="px-6 py-3"><div className="flex flex-wrap gap-1">{depts.map(d => <span key={d} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{d}</span>)}</div></td>
                          <td className="px-6 py-3 text-right text-gray-500">{fmt(c.amount)}</td>
                          <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(c.nextAmount)}</td>
                          <td className={`px-6 py-3 text-right font-medium ${diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>{diff >= 0 ? "+" : ""}{fmt(diff)}</td>
                          <td className="px-6 py-3">{inv && <Badge status={inv.status} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <DroppedClients clients={activeClients} currentMonthLabel={currentMonthLabel} nextMonthLabel={nextMonthLabel} />
          </div>
        )}

        {/* CLIENTS */}
        {tab === "clients" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-medium text-gray-800">Clients ({activeClients.length} active · {rawRows.length} service lines)</h2>
              <div className="flex gap-2 items-center">
                {monthCols.length > 0 && (
                  <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none text-gray-600">
                    {monthCols.map(c => <option key={c.h} value={c.h}>{formatMonthLabel(c.d)}</option>)}
                  </select>
                )}
                <button onClick={() => setShowAddClient(true)}
                  className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors">
                  + Add Client
                </button>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2 text-xs text-blue-600">
              💡 Click on any amount in the Current or Next Month columns to edit it inline. Changes are saved automatically.
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {clients.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-300 text-sm">No clients — import your data</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-400 border-b border-gray-50">
                    <th className="px-6 py-3 text-left">Client</th>
                    <th className="px-6 py-3 text-left">Lead</th>
                    <th className="px-6 py-3 text-left">Services</th>
                    <th className="px-6 py-3 text-left">Departments</th>
                    <th className="px-6 py-3 text-right">{currentMonthLabel || "Current"}</th>
                    <th className="px-6 py-3 text-right">{nextMonthLabel || "Next"}</th>
                    <th className="px-6 py-3 text-left">QBO Lines</th>
                    <th className="px-6 py-3 text-left">Status</th>
                  </tr></thead>
                  <tbody>
                    {clients.map(c => {
                      const services = [...new Set(c.lines.map(l => l.service))].filter(Boolean);
                      const depts = [...new Set(c.lines.map(l => l.department))].filter(Boolean);
                      return (
                        <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-3 font-medium text-gray-800">{c.name}</td>
                          <td className="px-6 py-3 text-xs text-gray-500">{c.lead || "—"}</td>
                          <td className="px-6 py-3 text-gray-500 text-xs">{services.join(", ")}</td>
                          <td className="px-6 py-3"><div className="flex flex-wrap gap-1">{depts.map(d => <span key={d} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{d}</span>)}</div></td>
                          <td className="px-6 py-3 text-right">
                            <EditableCell value={c.amount} onSave={v => updateAmount(c.id, "amount", v)} />
                          </td>
                          <td className="px-6 py-3 text-right">
                            <EditableCell value={c.nextAmount} onSave={v => updateAmount(c.id, "nextAmount", v)} />
                          </td>
                          <td className="px-6 py-3 text-xs">{c.multiDept ? <span className="text-blue-600">{depts.length} lines</span> : <span className="text-gray-400">1 line</span>}</td>
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-2">
                              <Badge status={c.status} />
                              {c.status === "active" && <button onClick={() => setClients(p => p.map(x => x.id === c.id ? {...x, status:"archived"} : x))} className="text-xs text-gray-300 hover:text-red-400 transition-colors">Archive</button>}
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
              <h2 className="font-medium text-gray-800">Invoices — {currentMonthLabel || "this month"}</h2>
              {!qboConnected && <p className="text-xs text-amber-600 bg-amber-50 px-3 py-1 rounded-full">Connect QBO to enable auto-send</p>}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {invoices.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-300 text-sm">No invoices — import your data first</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-400 border-b border-gray-50">
                    <th className="px-6 py-3 text-left">Client</th>
                    <th className="px-6 py-3 text-left">Lead</th>
                    <th className="px-6 py-3 text-right">Amount</th>
                    <th className="px-6 py-3 text-left">QBO Lines</th>
                    <th className="px-6 py-3 text-left">Approver</th>
                    <th className="px-6 py-3 text-left">Status</th>
                    <th className="px-6 py-3 text-left">Comment</th>
                    <th className="px-6 py-3"></th>
                  </tr></thead>
                  <tbody>
                    {invoices.map(inv => {
                      const activeLines = inv.lines?.filter(l => (l.amounts[inv.monthCol] || 0) > 0) || [];
                      return (
                        <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-3">
                            <div className="font-medium text-gray-800">{inv.clientName}</div>
                            {activeLines.length > 0 && <button onClick={() => setShowInvoiceDetail(inv)} className="text-xs text-blue-500 hover:underline">View {activeLines.length} line{activeLines.length > 1 ? "s" : ""}</button>}
                          </td>
                          <td className="px-6 py-3 text-xs text-gray-500">{inv.lead || "—"}</td>
                          <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(inv.amount)}</td>
                          <td className="px-6 py-3 text-xs">{inv.multiDept ? <span className="text-blue-600 font-medium">{[...new Set(inv.lines?.map(l => l.department))].filter(Boolean).length} sep. lines</span> : <span className="text-gray-400">1 line</span>}</td>
                          <td className="px-6 py-3 text-gray-500 text-xs">{inv.approver || "—"}</td>
                          <td className="px-6 py-3"><Badge status={inv.status} /></td>
                          <td className="px-6 py-3 text-gray-400 text-xs italic">{inv.comment || "—"}</td>
                          <td className="px-6 py-3 text-right">
                            <div className="flex gap-2 justify-end">
                              {inv.status === "pending" && <button onClick={() => { setShowApprove(inv); setApproveComment(""); }} className="text-xs bg-gray-900 text-white px-3 py-1 rounded-lg hover:bg-gray-700">Review</button>}
                              {inv.status === "see notes" && <button onClick={() => { setShowApprove(inv); setApproveComment(inv.comment); }} className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg hover:bg-orange-600">See Notes</button>}
                              {inv.status === "approved" && qboConnected && <button onClick={async () => { const u = invoices.map(i => i.id === inv.id ? {...i, status:"sent"} : i); setInvoices(u); await handleSaveInvoices(u); }} className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700">Send via QBO</button>}
                              {inv.status === "approved" && !qboConnected && <span className="text-xs text-gray-300">Connect QBO</span>}
                              {inv.status === "rejected" && <button onClick={async () => { const u = invoices.map(i => i.id === inv.id ? {...i, status:"pending", comment:""} : i); setInvoices(u); await handleSaveInvoices(u); }} className="text-xs text-amber-600 border border-amber-200 px-3 py-1 rounded-lg hover:bg-amber-50">Resubmit</button>}
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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="font-medium text-gray-800">Invoice Approvals</h2>
                <p className="text-xs text-gray-400 mt-0.5">Next month forecast ({nextLabelFromKey(curColKey, monthCols) || nextMonthLabel || "upcoming"}) vs current month ({labelFromKey(curColKey) || currentMonthLabel || "current"})</p>
              </div>
                              <div className="flex flex-col gap-2 items-end">
                  <div className="flex gap-1 flex-wrap justify-end">
                    {approvalLeads.map(l => (
                      <button key={l} onClick={() => setFilterLead(l)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${filterLead === l ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                        {l === "all" ? "All leads" : l}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {approvalStatuses.map(s => {
                      const colors = { all: "bg-gray-900 text-white", pending: "bg-amber-500 text-white", approved: "bg-blue-600 text-white", "see notes": "bg-orange-500 text-white", rejected: "bg-red-500 text-white", sent: "bg-purple-600 text-white" };
                      const inactive = "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50";
                      return (
                        <button key={s} onClick={() => setFilterStatus(s)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${filterStatus === s ? (colors[s] || "bg-gray-900 text-white") : inactive}`}>
                          {s === "all" ? "All statuses" : s}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-full">{filteredApprovals.filter(i => i.status === "pending").length} pending</span>
                    <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full">{filteredApprovals.filter(i => i.status === "approved").length} approved</span>
                  </div>
                </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {filteredApprovals.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-300 text-sm">{invoices.length === 0 ? "No invoices — import your data first" : "No invoices for this lead"}</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-400 border-b border-gray-50">
                    <th className="px-6 py-3 text-left">Client</th>
                    <th className="px-6 py-3 text-left">Lead</th>
                    <th className="px-6 py-3 text-left">Departments</th>
                    <th className="px-6 py-3 text-right">{labelFromKey(curColKey) || currentMonthLabel || "Current"}</th>
                    <th className="px-6 py-3 text-right">{nextLabelFromKey(curColKey, monthCols) || nextMonthLabel || "Next Month"}</th>
                    <th className="px-6 py-3 text-right">Change</th>
                    <th className="px-6 py-3 text-left">Status</th>
                    <th className="px-6 py-3 text-left">Comment</th>
                    <th className="px-6 py-3"></th>
                  </tr></thead>
                  <tbody>
                    {filteredApprovals.map(inv => {
                      const diff = inv.nextAmount - inv.amount;
                      const activeLines = inv.lines?.filter(l => (l.amounts[inv.nextMonthCol] || 0) > 0) || [];
                      const depts = [...new Set(inv.lines?.map(l => l.department).filter(Boolean))];
                      return (
                        <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-3">
                            <div className="font-medium text-gray-800">{inv.clientName}</div>
                            {activeLines.length > 0 && <button onClick={() => setShowInvoiceDetail({ ...inv, monthCol: inv.nextMonthCol, amount: inv.nextAmount })} className="text-xs text-blue-500 hover:underline">View {activeLines.length} line{activeLines.length > 1 ? "s" : ""}</button>}
                          </td>
                          <td className="px-6 py-3 text-xs text-gray-500">{inv.lead || "—"}</td>
                          <td className="px-6 py-3"><div className="flex flex-wrap gap-1">{depts.map(d => <span key={d} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{d}</span>)}</div></td>
                          <td className="px-6 py-3 text-right text-gray-500">{fmt(inv.amount)}</td>
                          <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(inv.nextAmount)}</td>
                          <td className={`px-6 py-3 text-right font-medium ${diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>{diff >= 0 ? "+" : ""}{fmt(diff)}</td>
                          <td className="px-6 py-3"><Badge status={inv.status} /></td>
                          <td className="px-6 py-3 text-gray-400 text-xs italic">{inv.comment || "—"}</td>
                          <td className="px-6 py-3 text-right">
                            <div className="flex gap-2 justify-end">
                              {inv.status === "pending" && <button onClick={() => { setShowApprove(inv); setApproveComment(""); }} className="text-xs bg-gray-900 text-white px-3 py-1 rounded-lg hover:bg-gray-700">Review</button>}
                              {inv.status === "see notes" && <button onClick={() => { setShowApprove(inv); setApproveComment(inv.comment); }} className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg hover:bg-orange-600">See Notes</button>}
                              {inv.status === "approved" && qboConnected && <button onClick={async () => { const u = invoices.map(i => i.id === inv.id ? {...i, status:"sent"} : i); setInvoices(u); await handleSaveInvoices(u); }} className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700">Send via QBO</button>}
                              {inv.status === "approved" && !qboConnected && <span className="text-xs text-gray-300">Connect QBO</span>}
                              {inv.status === "rejected" && <button onClick={async () => { const u = invoices.map(i => i.id === inv.id ? {...i, status:"pending", comment:""} : i); setInvoices(u); await handleSaveInvoices(u); }} className="text-xs text-amber-600 border border-amber-200 px-3 py-1 rounded-lg hover:bg-amber-50">Resubmit</button>}
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

        {/* AI ASSISTANT */}
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
              <input value={aiInput} onChange={e => setAiInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendAI()}
                placeholder="e.g. Which clients have more than one department?" className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-gray-400" />
              <button onClick={sendAI} disabled={aiLoading} className="bg-gray-900 text-white px-4 py-2 rounded-xl text-sm hover:bg-gray-700 disabled:opacity-40">Send</button>
            </div>
          </div>
        )}
      </div>

      {/* IMPORT MODAL */}
      {showImport && (
        <Modal title="Import from Google Sheets" onClose={() => setShowImport(false)} wide>
          <div className="space-y-4">
            <div className="flex rounded-xl overflow-hidden border border-gray-100">
              {["clients","leads"].map((s, idx) => (
                <button key={s} onClick={() => setImportStep(s)}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${importStep === s ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}>
                  {idx + 1}. {s === "clients" ? "Forecasted Revenues" : "Leads (team)"}
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
                  <p className="text-blue-500">Existing approval statuses are preserved on re-import.</p>
                </div>
                <textarea value={clientPaste} onChange={e => setClientPaste(e.target.value)}
                  placeholder={"Client Name\tService\tDepartment\t01/01/2025\t02/01/2025\nAcme Corp\tPaid\tCore Growth\t4500\t5000"}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono outline-none focus:border-gray-400 resize-none" rows={9} />
                <button onClick={() => setImportStep("leads")} disabled={!clientPaste.trim()}
                  className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">Next: Paste team data</button>
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
                <textarea value={leadPaste} onChange={e => setLeadPaste(e.target.value)}
                  placeholder={"Client\tLead\nAcme Corp\tSarah Johnson"}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono outline-none focus:border-gray-400 resize-none" rows={6} />
                {importError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{importError}</p>}
                <div className="flex gap-3">
                  <button onClick={() => setImportStep("clients")} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Back</button>
                  <button onClick={processImport} disabled={!clientPaste.trim()}
                    className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">Import data</button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ADD CLIENT MODAL */}
      {showAddClient && (
        <Modal title="Add New Client" onClose={() => setShowAddClient(false)}>
          <div className="space-y-3">
            <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700">
              This client is added manually and won't affect your Google Sheet. It will be saved to the dashboard automatically.
            </div>
            {[["Client Name *","name","text"],["Service","service","text"],["Department","department","text"],["Lead","lead","text"]].map(([label, key, type]) => (
              <div key={key}>
                <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                <input type={type} value={newClient[key]} onChange={e => setNewClient(p => ({...p, [key]: e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400" />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{currentMonthLabel || "Current month"} ($)</label>
                <input type="number" value={newClient.currentAmt} onChange={e => setNewClient(p => ({...p, currentAmt: e.target.value}))}
                  placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{nextMonthLabel || "Next month"} ($)</label>
                <input type="number" value={newClient.nextAmt} onChange={e => setNewClient(p => ({...p, nextAmt: e.target.value}))}
                  placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowAddClient(false); setNewClient({ name:"", service:"", department:"", lead:"", currentAmt:"", nextAmt:"" }); }}
                className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={addClientManually} disabled={!newClient.name.trim()}
                className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">Add Client</button>
            </div>
          </div>
        </Modal>
      )}

      {/* INVOICE DETAIL MODAL */}
      {showInvoiceDetail && (
        <Modal title={`Invoice lines — ${showInvoiceDetail.clientName}`} onClose={() => setShowInvoiceDetail(null)} wide>
          <div className="space-y-3">
            <p className="text-xs text-gray-400">Month: {showInvoiceDetail.month} · {showInvoiceDetail.multiDept ? "Separate QBO lines per department" : "Single QBO line"}</p>
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="py-2 text-left">Service</th>
                <th className="py-2 text-left">Department</th>
                <th className="py-2 text-left">Lead</th>
                <th className="py-2 text-right">Amount</th>
              </tr></thead>
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
              <tfoot><tr>
                <td colSpan={3} className="pt-3 text-sm font-medium text-gray-600">Total</td>
                <td className="pt-3 text-right font-semibold text-gray-900">{fmt(showInvoiceDetail.amount)}</td>
              </tr></tfoot>
            </table>
            <button onClick={() => setShowInvoiceDetail(null)} className="w-full border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Close</button>
          </div>
        </Modal>
      )}

      {/* APPROVE MODAL */}
      {showApprove && (
        <Modal title={`Review Invoice — ${showApprove.clientName}`} onClose={() => setShowApprove(null)}>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between"><span className="text-gray-500">Client</span><span className="font-medium">{showApprove.clientName}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Lead</span><span>{showApprove.lead || "—"}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Current month</span><span>{fmt(showApprove.amount)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Next month</span><span className="font-semibold text-gray-900">{fmt(showApprove.nextAmount)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">QBO lines</span><span>{showApprove.multiDept ? `${[...new Set(showApprove.lines?.map(l => l.department))].filter(Boolean).length} separate lines` : "1 line"}</span></div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Approver</label>
              <select value={showApprove.approver} onChange={e => setShowApprove(p => ({...p, approver: e.target.value}))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none">
                {(approvers.length ? approvers : ["—"]).map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Comment (optional)</label>
              <textarea value={approveComment} onChange={e => setApproveComment(e.target.value)} rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none resize-none focus:border-gray-400" />
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

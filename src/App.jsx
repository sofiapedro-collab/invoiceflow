
import { useEffect, useMemo, useRef, useState } from "react";

const SUPABASE_URL = "https://hpycqegogkqsodvykqfj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHB5Y3FlZ29na3Fzb2R2eWtxZmoiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc3Mzk1NTExNywiZXhwIjoyMDg5NTMxMTE3fQ.Rb5r_9gsNNVIl0e9dqYraYJdDayvunqEMfQ_I8FmfKI";

async function loadFromSupabase() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/invoiceflow_data?id=eq.main&select=data`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const rows = await res.json();
  return rows?.[0]?.data || null;
}

async function saveToSupabase(data) {
  await fetch(`${SUPABASE_URL}/rest/v1/invoiceflow_data?id=eq.main`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
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

  const [showApprove, setShowApprove] = useState(null);
  const [showInvoiceDetail, setShowInvoiceDetail] = useState(null);
  const [approveComment, setApproveComment] = useState("");
  const [qboConnected, setQboConnected] = useState(false);
  const [qboSyncing, setQboSyncing] = useState(false);
  const [saving, setSaving] = useState(false);

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

  function buildSnapshot(overrides = {}) {
    return {
      rawRows: overrides.rawRows ?? rawRows,
      clients: overrides.clients ?? clients,
      approvers: overrides.approvers ?? approvers,
      approvalHistory: overrides.approvalHistory ?? approvalHistory,
      monthCols: overrides.monthCols ?? monthCols,
      curColKey: overrides.curColKey ?? billingContext.curKey,
      approvalMonthKey: overrides.approvalMonthKey ?? effectiveApprovalMonthKey,
      connected: overrides.connected ?? connected,
    };
  }

  async function persistSnapshot(overrides = {}) {
    setSaving(true);
    try {
      await saveToSupabase(buildSnapshot(overrides));
    } catch (_) {
      // no-op
    }
    setSaving(false);
  }

  useEffect(() => {
    async function load() {
      try {
        const d = await loadFromSupabase();
        const loadedClients = d?.clients || [];
        if (loadedClients.length || d?.rawRows?.length) {
          const loadedMonthCols = d.monthCols || [];
          const initialContext = getMonthContext(loadedMonthCols, d.curColKey || "");
          const initialApprovalKey = d.approvalMonthKey || initialContext.curKey || "";

          setRawRows(d.rawRows || []);
          setClients(loadedClients);
          setApprovers(d.approvers || []);
          setApprovalHistory(d.approvalHistory || migrateApprovalHistory(d.invoices));
          setMonthCols(loadedMonthCols);
          setCurColKey(initialContext.curKey);
          setApprovalMonthKey(initialApprovalKey);
          setConnected(true);
          setAiMessages([{ role: "assistant", content: `Data loaded: ${loadedClients.length} clients. Ask me anything!` }]);
        }
      } catch (_) {
        // no-op
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
        return {
          id: existing?.id || `import-${idx + 1}`,
          name: group.name,
          status: existing?.status || "active",
          lead,
          manual: false,
          lines: group.lines.map(line => ({ ...line, lead: line.lead || lead })),
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

  async function sendInvoiceToQBO(inv) {
    await saveApprovalEntry(inv.approvalMonthKey, inv.clientName, {
      status: "sent",
      comment: inv.comment || "",
      approver: inv.approver || "",
    });
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
CLIENTS: ${JSON.stringify(scopedClients.map(c => ({ name: c.name, lead: c.lead, projectedAmount: c.amount, previousAmount: c.lastAmount, nextAmount: c.nextAmount })))}
INVOICES: ${JSON.stringify(billingInvoices.map(i => ({ client: i.clientName, lead: i.lead, amount: i.amount, status: i.status })))}
PROJECTED MONTH: ${currentMonthLabel}, PREVIOUS MONTH: ${lastMonthLabel}, NEXT MONTH: ${nextMonthLabel}
TOTAL PROJECTED MONTH: ${fmt(totalProjected)}, TOTAL PREVIOUS MONTH: ${fmt(totalLast)}, TOTAL NEXT MONTH: ${fmt(totalNext)}
Answer concisely in English. Use USD formatting.`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
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

  const tabs = ["dashboard", "clients", "invoices", "invoice approvals", "ai assistant"];

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

          <button
            onClick={
              qboConnected
                ? undefined
                : () => {
                    setQboSyncing(true);
                    setTimeout(() => {
                      setQboConnected(true);
                      setQboSyncing(false);
                    }, 1800);
                  }
            }
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              qboConnected ? "bg-emerald-50 text-emerald-700 cursor-default border border-emerald-200" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {qboSyncing ? "Connecting..." : qboConnected ? "QBO Connected" : "Connect QuickBooks"}
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
                            <td className="px-6 py-3 font-medium text-gray-800">{client.name}</td>
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
                <button onClick={() => setShowAddClient(true)} className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors">
                  + Add Client
                </button>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2 text-xs text-blue-600">
              Click any amount in the Current or Next Month columns to edit it inline. Changes are saved automatically.
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {scopedClients.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-300 text-sm">No clients — import your data</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-50">
                      <th className="px-6 py-3 text-left">Client</th>
                      <th className="px-6 py-3 text-left">Lead</th>
                      <th className="px-6 py-3 text-left">Services</th>
                      <th className="px-6 py-3 text-left">Departments</th>
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
                                <button onClick={() => sendInvoiceToQBO(inv)} className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700">
                                  Send via QBO
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
                            {formatMonthLabel(col.d)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button onClick={resetApprovalsForMonth} disabled={!effectiveApprovalMonthKey} className="px-3 py-2 rounded-lg text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">
                    Clear approvals for this month
                  </button>
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
                                <button onClick={() => sendInvoiceToQBO(inv)} className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700">
                                  Send via QBO
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
                  <p className="text-blue-500">Manual clients and per-month approval history are preserved on re-import.</p>
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
                {showInvoiceDetail.lines?.filter(line => (line.amounts[showInvoiceDetail.monthCol] || 0) > 0).map((line, idx) => (
                  <tr key={idx} className="border-b border-gray-50">
                    <td className="py-2 text-gray-700">{line.service}</td>
                    <td className="py-2">
                      <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{line.department}</span>
                    </td>
                    <td className="py-2 text-xs text-gray-500">{line.lead || "—"}</td>
                    <td className="py-2 text-right font-medium text-gray-800">{fmt(line.amounts[showInvoiceDetail.monthCol])}</td>
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

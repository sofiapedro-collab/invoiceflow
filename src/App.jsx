import { useState, useRef, useEffect, useCallback } from "react";

const SB_URL = "https://hpycqegogkqsodvykqfj.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhweWNxZWdvZ2txc29kdnlrcWZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTUxMTcsImV4cCI6MjA4OTUzMTExN30.Rb5r_9gsNNVIl0e9dqYraYJdDayvunqEMfQ_I8FmfKI";
const hdrs = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function sbGet(key) {
  const r = await fetch(`${SB_URL}/rest/v1/invoiceflow_data?id=eq.${key}&select=data`, { headers: hdrs });
  const rows = await r.json();
  return rows?.[0]?.data || null;
}
async function sbSet(key, data) {
  // upsert
  await fetch(`${SB_URL}/rest/v1/invoiceflow_data`, {
    method: "POST",
    headers: { ...hdrs, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: key, data, updated_at: new Date().toISOString() })
  });
}

// ── Formatting helpers ────────────────────────────────────────────────────────
const fmt = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });
const DEPT_LEADS = { "fiat finance": "Kaley", "uncovered": "Nick" };
const defaultLead = d => DEPT_LEADS[d?.toLowerCase().trim()] || "";

function parseColDate(h) {
  h = String(h);
  let m = h.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[1] - 1, 1);
  const mos = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  m = h.match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (m) { const mo = mos.indexOf(m[1].toLowerCase()); if (mo >= 0) return new Date(+m[2], mo, 1); }
  return null;
}
function fmtMonthKey(h) {
  const d = parseColDate(h); if (!d) return h;
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}
function parsePaste(t) { return t.trim().split("\n").map(r => r.split("\t").map(c => c.trim())); }
function toObjs(rows) {
  if (rows.length < 2) return { objects: [], headers: [] };
  const headers = rows[0];
  return { headers, objects: rows.slice(1).filter(r => r.some(c => c)).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]))) };
}
function parseAmt(v) { return parseFloat(String(v || "").replace(/[$,\s]/g, "")) || 0; }
function getMonthCols(headers) { return headers.map((h, i) => ({ h, i, d: parseColDate(h) })).filter(x => x.d).sort((a, b) => a.d - b.d); }

// ── Small UI components ───────────────────────────────────────────────────────
function Badge({ status }) {
  const s = { active:"bg-emerald-50 text-emerald-700", pending:"bg-amber-50 text-amber-700", approved:"bg-blue-50 text-blue-700", sent:"bg-purple-50 text-purple-700", rejected:"bg-red-50 text-red-700", archived:"bg-gray-100 text-gray-500", "see notes":"bg-orange-50 text-orange-600" };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s[status]||"bg-gray-100 text-gray-500"}`}>{status.charAt(0).toUpperCase()+status.slice(1)}</span>;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-20 p-4">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide?"max-w-3xl":"max-w-md"} p-6 max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Inline editable amount — saves immediately on blur/Enter
function EditAmt({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const ref = useRef();
  function start() { setVal(String(value||0)); setEditing(true); setTimeout(()=>ref.current?.select(),30); }
  function commit() { const n = parseAmt(val); onSave(n); setEditing(false); }
  if (editing) return <input ref={ref} value={val} onChange={e=>setVal(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")commit();if(e.key==="Escape")setEditing(false);}} className="w-24 border border-blue-300 rounded px-2 py-0.5 text-right text-xs outline-none bg-blue-50"/>;
  return <span onClick={start} title="Click to edit" className="cursor-pointer hover:bg-blue-50 hover:text-blue-700 px-1 py-0.5 rounded transition-colors font-medium text-gray-800">{fmt(value)}</span>;
}

function SaveIndicator({ state }) {
  // state: idle | saving | saved | error
  if (state === "idle") return null;
  const map = { saving: "text-gray-400", saved: "text-emerald-600", error: "text-red-500" };
  const label = { saving: "Saving…", saved: "✓ Saved", error: "Save failed" };
  return <span className={`text-xs font-medium ${map[state]}`}>{label[state]}</span>;
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("idle");
  const saveTimer = useRef(null);

  // Core data — stored in "core" key in Supabase
  const [clients, setClients] = useState([]);       // grouped client list
  const [rawRows, setRawRows] = useState([]);         // all service lines
  const [approvers, setApprovers] = useState([]);
  const [monthCols, setMonthCols] = useState([]);     // [{h, d}]

  // Active billing month (col key like "04/01/2026")
  const [billingMonth, setBillingMonth] = useState("");  // current month col key
  const [viewMonth, setViewMonth] = useState("");        // what user is viewing in approvals

  // Approvals stored per month: { "04/01/2026": [{...invoice}] }
  const [allApprovals, setAllApprovals] = useState({});

  const [tab, setTab] = useState("dashboard");
  const [showImport, setShowImport] = useState(false);
  const [importStep, setImportStep] = useState("clients");
  const [clientPaste, setClientPaste] = useState("");
  const [leadPaste, setLeadPaste] = useState("");
  const [importError, setImportError] = useState("");
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClient, setNewClient] = useState({ name:"", service:"", department:"", lead:"", currentAmt:"", nextAmt:"" });
  const [showApprove, setShowApprove] = useState(null);
  const [approveComment, setApproveComment] = useState("");
  const [showInvoiceDetail, setShowInvoiceDetail] = useState(null);
  const [showCloseMonth, setShowCloseMonth] = useState(false);
  const [qboConnected, setQboConnected] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState("");  // for clients tab display
  const [filterLead, setFilterLead] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [aiMessages, setAiMessages] = useState([{ role:"assistant", content:"Hi! Import your data and ask me anything about clients, invoices, or monthly performance." }]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const chatEnd = useRef(null);
  useEffect(()=>{ chatEnd.current?.scrollIntoView({behavior:"smooth"}); }, [aiMessages]);

  // ── Load from Supabase ──
  useEffect(()=>{
    (async()=>{
      try {
        const core = await sbGet("core");
        if (core?.clients?.length) {
          setClients(core.clients||[]);
          setRawRows(core.rawRows||[]);
          setApprovers(core.approvers||[]);
          setMonthCols((core.monthCols||[]).map(c=>({...c,d:parseColDate(c.h)})). filter(c=>c.d));
          setBillingMonth(core.billingMonth||"");
          setViewMonth(core.billingMonth||"");
          setSelectedMonth(core.billingMonth||"");
        }
        const appData = await sbGet("approvals");
        if (appData) setAllApprovals(appData);
      } catch(_){}
      setLoading(false);
    })();
  },[]);

  // ── Save helpers ──
  function triggerSave(coreData, approvalsData) {
    clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async()=>{
      try {
        if (coreData) await sbSet("core", coreData);
        if (approvalsData) await sbSet("approvals", approvalsData);
        setSaveState("saved");
        setTimeout(()=>setSaveState("idle"), 2000);
      } catch(_){ setSaveState("error"); }
    }, 600); // debounce 600ms — batches rapid edits
  }

  function buildCore(overrides={}) {
    return { clients, rawRows, approvers, monthCols: monthCols.map(c=>({h:c.h})), billingMonth, ...overrides };
  }

  // ── Current month invoices ──
  const currentInvoices = allApprovals[billingMonth] || [];
  const viewInvoices = allApprovals[viewMonth] || [];
  const isViewingActive = viewMonth === billingMonth;

  // ── Derived ──
  const activeClients = clients.filter(c=>c.status==="active");
  const billingIdx = monthCols.findIndex(c=>c.h===billingMonth);
  const nextColKey = billingIdx >= 0 && billingIdx < monthCols.length-1 ? monthCols[billingIdx+1].h : "";
  const prevColKey = billingIdx > 0 ? monthCols[billingIdx-1].h : "";
  const billingLabel = fmtMonthKey(billingMonth);
  const nextLabel = fmtMonthKey(nextColKey);
  const prevLabel = fmtMonthKey(prevColKey);
  const viewLabel = fmtMonthKey(viewMonth);
  const nextViewKey = (() => { const i = monthCols.findIndex(c=>c.h===viewMonth); return i>=0&&i<monthCols.length-1?monthCols[i+1].h:""; })();
  const nextViewLabel = fmtMonthKey(nextViewKey);

  const totalBilling = activeClients.reduce((s,c)=>s+(c.lines?.reduce((ss,l)=>ss+(l.amounts?.[billingMonth]||0),0)||0),0);
  const totalNext = activeClients.reduce((s,c)=>s+(c.lines?.reduce((ss,l)=>ss+(l.amounts?.[nextColKey]||0),0)||0),0);
  const totalPrev = activeClients.reduce((s,c)=>s+(c.lines?.reduce((ss,l)=>ss+(l.amounts?.[prevColKey]||0),0)||0),0);
  const pendingCount = currentInvoices.filter(i=>i.nextAmount>0&&i.status==="pending").length;
  const approvedCount = currentInvoices.filter(i=>i.status==="approved").length;

  // ── Build invoices for a month ──
  function buildInvoicesForMonth(colKey, nextKey, existing=[]) {
    return activeClients.map((c,i)=>{
      const amt = c.lines?.reduce((s,l)=>s+(l.amounts?.[colKey]||0),0)||0;
      const nxt = c.lines?.reduce((s,l)=>s+(l.amounts?.[nextKey]||0),0)||0;
      const prev = existing.find(e=>e.clientName===c.name);
      return {
        id: prev?.id || Date.now()+i,
        clientId: c.id, clientName: c.name,
        amount: amt, nextAmount: nxt,
        approver: prev?.approver || approvers[0]||"",
        lead: c.lead,
        status: prev?.status||"pending",
        comment: prev?.comment||"",
        month: fmtMonthKey(colKey),
        monthCol: colKey, nextMonthCol: nextKey,
        lines: c.lines, multiDept: c.multiDept,
      };
    });
  }

  // ── Update a client amount (immediate save) ──
  async function updateClientAmt(clientId, colKey, newVal) {
    const updatedClients = clients.map(c=>{
      if (c.id !== clientId) return c;
      const updatedLines = c.lines.map(l=>({...l, amounts:{...l.amounts,[colKey]:newVal/(c.lines.length)}}));
      // distribute evenly across lines — or just update total on client
      return {...c, lines: c.lines.map(l=>l), _amtOverride:{...c._amtOverride,[colKey]:newVal}};
    });
    // Simpler: store override on client level
    const final = clients.map(c=>c.id===clientId ? {...c, _amtOverride:{...(c._amtOverride||{}),[colKey]:newVal}} : c);
    setClients(final);
    // Also update invoices for affected months
    const newAllApprovals = {...allApprovals};
    Object.keys(newAllApprovals).forEach(mk=>{
      newAllApprovals[mk] = newAllApprovals[mk].map(inv=>{
        if (inv.clientId !== clientId) return inv;
        const amt = mk === colKey ? newVal : inv.amount;
        const nxt = inv.nextMonthCol === colKey ? newVal : inv.nextAmount;
        return {...inv, amount: amt, nextAmount: nxt};
      });
    });
    setAllApprovals(newAllApprovals);
    triggerSave(buildCore({clients:final}), newAllApprovals);
  }

  // Helper: get display amount for a client+col (respects override)
  function getClientAmt(c, colKey) {
    if (c._amtOverride?.[colKey] !== undefined) return c._amtOverride[colKey];
    return c.lines?.reduce((s,l)=>s+(l.amounts?.[colKey]||0),0)||0;
  }

  // ── Approve invoice ──
  async function approveInvoice(decision) {
    const updated = viewInvoices.map(i=>i.id===showApprove.id?{...i,status:decision,comment:approveComment}:i);
    const newAll = {...allApprovals,[viewMonth]:updated};
    setAllApprovals(newAll);
    setShowApprove(null); setApproveComment("");
    triggerSave(null, newAll);
  }

  // ── Close month & open next ──
  async function closeMonth() {
    const nextKey = nextColKey;
    if (!nextKey) return;
    // Archive current — already saved. Build new approvals for next month.
    const nextNext = (() => { const i = monthCols.findIndex(c=>c.h===nextKey); return i>=0&&i<monthCols.length-1?monthCols[i+1].h:""; })();
    const existing = allApprovals[nextKey]||[];
    const newInvoices = buildInvoicesForMonth(nextKey, nextNext, existing);
    const newAll = {...allApprovals,[nextKey]:newInvoices};
    const newCore = buildCore({billingMonth:nextKey});
    setAllApprovals(newAll);
    setBillingMonth(nextKey);
    setViewMonth(nextKey);
    setSelectedMonth(nextKey);
    setShowCloseMonth(false);
    triggerSave(newCore, newAll);
  }

  // ── Import ──
  async function processImport() {
    setImportError("");
    try {
      const rows = parsePaste(clientPaste);
      const {objects, headers} = toObjs(rows);
      if (!objects.length) throw new Error("No data found. Include the header row.");
      const cols = getMonthCols(headers);
      if (!cols.length) throw new Error("No month columns found. Expected format: 01/01/2025 or Jan 2025.");

      const nameKey = headers.find(h=>/client.*name|^client$/i.test(h));
      const serviceKey = headers.find(h=>/^service$/i.test(h));
      const deptKey = headers.find(h=>/department|dept/i.test(h));
      if (!nameKey) throw new Error("Could not find 'Client Name' column.");

      let leadMap={}, appNames=[];
      if (leadPaste.trim()) {
        const lr = parsePaste(leadPaste);
        const {objects:lo, headers:lh} = toObjs(lr);
        const ck = lh.find(h=>/^client$/i.test(h))||lh[0];
        const lk = lh.find(h=>/^lead$/i.test(h))||lh[1];
        lo.forEach(r=>{ const cn=r[ck]?.trim(); const ln=r[lk]?.trim(); if(cn&&ln) leadMap[cn.toLowerCase()]=ln; });
        appNames = [...new Set(lo.map(r=>r[lk]).filter(Boolean))];
      }

      const resolveLead = (name,dept) => leadMap[name?.toLowerCase()] || defaultLead(dept) || "";
      const enriched = objects.filter(r=>r[nameKey]?.trim()).map((r,i)=>{
        const dept = deptKey?(r[deptKey]||""):"";
        return { _id:i, clientName:r[nameKey].trim(), service:serviceKey?(r[serviceKey]||""):"", department:dept, lead:resolveLead(r[nameKey].trim(),dept), amounts:Object.fromEntries(cols.map(c=>[c.h,parseAmt(r[c.h])])) };
      });

      const grouped={};
      enriched.forEach(r=>{ if(!grouped[r.clientName]) grouped[r.clientName]={name:r.clientName,lines:[]}; grouped[r.clientName].lines.push(r); });

      const clientList = Object.values(grouped).map((g,i)=>({
        id:i+1, name:g.name, status:"active", lines:g.lines,
        lead:g.lines.find(l=>l.lead)?.lead||"",
        multiDept: new Set(g.lines.map(l=>l.department).filter(Boolean)).size>1,
      }));

      // Use existing billing month or pick best col
      const now = new Date();
      let bestKey = billingMonth;
      if (!bestKey || !cols.find(c=>c.h===bestKey)) {
        const found = cols.find(c=>c.d.getMonth()===now.getMonth()&&c.d.getFullYear()===now.getFullYear());
        bestKey = found?.h || cols[cols.length-2]?.h || cols[cols.length-1]?.h;
      }
      const bestIdx = cols.findIndex(c=>c.h===bestKey);
      const nextKey2 = bestIdx<cols.length-1?cols[bestIdx+1].h:"";

      // Build approvals for billing month — preserve existing statuses
      const existing = allApprovals[bestKey]||[];
      const newInvoices = clientList.map((c,i)=>{
        const amt = c.lines.reduce((s,l)=>s+(l.amounts?.[bestKey]||0),0);
        const nxt = c.lines.reduce((s,l)=>s+(l.amounts?.[nextKey2]||0),0);
        const prev = existing.find(e=>e.clientName===c.name);
        return {
          id:i+1, clientId:c.id, clientName:c.name, amount:amt, nextAmount:nxt,
          approver:prev?.approver||appNames[0]||"", lead:c.lead,
          status: prev && prev.status!=="pending" ? prev.status : "pending",
          comment:prev?.comment||"",
          month:fmtMonthKey(bestKey), monthCol:bestKey, nextMonthCol:nextKey2,
          lines:c.lines, multiDept:c.multiDept,
        };
      });

      const newAll = {...allApprovals,[bestKey]:newInvoices};
      const core = {clients:clientList, rawRows:enriched, approvers:appNames, monthCols:cols.map(c=>({h:c.h})), billingMonth:bestKey};

      setClients(clientList); setRawRows(enriched); setApprovers(appNames);
      setMonthCols(cols); setBillingMonth(bestKey); setViewMonth(bestKey); setSelectedMonth(bestKey);
      setAllApprovals(newAll);
      setShowImport(false); setClientPaste(""); setLeadPaste(""); setImportStep("clients");
      setAiMessages([{role:"assistant",content:`Synced ${clientList.length} clients. Ask me anything!`}]);
      triggerSave(core, newAll);
    } catch(e){ setImportError(e.message); }
  }

  // ── Add client manually ──
  async function addClientManually() {
    if (!newClient.name.trim()) return;
    const id = Date.now();
    const lead = newClient.lead.trim() || defaultLead(newClient.department) || "";
    const amounts = {};
    if (billingMonth) amounts[billingMonth] = parseFloat(newClient.currentAmt)||0;
    if (nextColKey) amounts[nextColKey] = parseFloat(newClient.nextAmt)||0;
    const line = {_id:id, clientName:newClient.name.trim(), service:newClient.service, department:newClient.department, lead, amounts};
    const c = {id, name:newClient.name.trim(), status:"active", lines:[line], lead, multiDept:false};
    const newClients = [...clients, c];
    const invEntry = {
      id, clientId:id, clientName:c.name,
      amount:parseFloat(newClient.currentAmt)||0,
      nextAmount:parseFloat(newClient.nextAmt)||0,
      approver:approvers[0]||"", lead,
      status:"pending", comment:"",
      month:billingLabel, monthCol:billingMonth, nextMonthCol:nextColKey,
      lines:[line], multiDept:false,
    };
    const newAll = {...allApprovals,[billingMonth]:[...(allApprovals[billingMonth]||[]),invEntry]};
    setClients(newClients); setAllApprovals(newAll);
    setShowAddClient(false);
    setNewClient({name:"",service:"",department:"",lead:"",currentAmt:"",nextAmt:""});
    triggerSave(buildCore({clients:newClients}), newAll);
  }

  // ── AI ──
  async function sendAI() {
    if (!aiInput.trim()||aiLoading) return;
    const msg = aiInput.trim(); setAiInput("");
    setAiMessages(p=>[...p,{role:"user",content:msg}]);
    setAiLoading(true);
    const ctx = `Finance assistant for a service business.
CLIENTS: ${JSON.stringify(clients.map(c=>({name:c.name,lead:c.lead})))}
BILLING MONTH: ${billingLabel}, NEXT: ${nextLabel}
APPROVALS THIS MONTH: ${JSON.stringify(currentInvoices.map(i=>({client:i.clientName,amount:i.amount,nextAmount:i.nextAmount,status:i.status})))}
Answer concisely in English, USD formatting.`;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:ctx,messages:[{role:"user",content:msg}]})});
      const d = await r.json();
      setAiMessages(p=>[...p,{role:"assistant",content:d.content?.find(b=>b.type==="text")?.text||"Could not process that."}]);
    } catch{ setAiMessages(p=>[...p,{role:"assistant",content:"Something went wrong."}]); }
    setAiLoading(false);
  }

  const tabs = ["dashboard","clients","invoices","invoice approvals","ai assistant"];
  const connected = clients.length > 0;

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400 text-sm">Loading…</p></div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">InvoiceFlow</h1>
          <p className="text-xs text-gray-400">Service Business Dashboard</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SaveIndicator state={saveState} />

          {/* Billing month selector */}
          {monthCols.length > 0 && (
            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-400">Billing month:</span>
              <select value={billingMonth} onChange={async e=>{
                const key = e.target.value;
                const idx = monthCols.findIndex(c=>c.h===key);
                const nk = idx<monthCols.length-1?monthCols[idx+1].h:"";
                setBillingMonth(key); setViewMonth(key); setSelectedMonth(key);
                // Build approvals for this month if not yet existing
                if (!allApprovals[key]) {
                  const inv = buildInvoicesForMonth(key, nk, []);
                  const newAll = {...allApprovals,[key]:inv};
                  setAllApprovals(newAll);
                  triggerSave(buildCore({billingMonth:key}), newAll);
                } else {
                  triggerSave(buildCore({billingMonth:key}), null);
                }
              }} className="text-xs font-medium text-gray-700 outline-none bg-transparent">
                {monthCols.map(c=><option key={c.h} value={c.h}>{fmtMonthKey(c.h)}</option>)}
              </select>
            </div>
          )}

          {approvedCount > 0 && (
            <button onClick={()=>{
              const approved = currentInvoices.filter(i=>i.status==="approved");
              const rows=[["Client","Lead","Department","Service","Month","Amount"]];
              approved.forEach(inv=>{
                const lines=inv.lines?.filter(l=>(l.amounts?.[inv.monthCol]||0)>0)||[];
                if(!lines.length) rows.push([inv.clientName,inv.lead,"","",inv.month,inv.amount]);
                else lines.forEach(l=>rows.push([inv.clientName,inv.lead,l.department,l.service,inv.month,l.amounts[inv.monthCol]]));
              });
              const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
              const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
              a.download=`approved-${billingLabel.replace(" ","-")}.csv`; a.click();
            }} className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700">
              Export Approved CSV
            </button>
          )}

          <button onClick={()=>setShowCloseMonth(true)} className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600">
            Close Month →
          </button>

          <button onClick={()=>{setShowImport(true);setImportStep("clients");setImportError("");}}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${connected?"border-emerald-200 bg-emerald-50 text-emerald-700":"border-gray-900 bg-gray-900 text-white hover:bg-gray-700"}`}>
            {connected?`${clients.length} clients — Re-import`:"Import from Sheet"}
          </button>

          <button onClick={qboConnected?undefined:()=>{setTimeout(()=>setQboConnected(true),1200);}}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${qboConnected?"bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            {qboConnected?"✓ QBO Connected":"Connect QuickBooks"}
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="bg-white border-b border-gray-100 px-6 overflow-x-auto">
        <div className="flex gap-6 min-w-max">
          {tabs.map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors capitalize whitespace-nowrap ${tab===t?"border-gray-900 text-gray-900":"border-transparent text-gray-400 hover:text-gray-600"}`}>
              {t==="invoice approvals"&&pendingCount>0
                ?<span className="flex items-center gap-1.5">Invoice Approvals <span className="bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">{pendingCount}</span></span>
                :t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {!connected && (
        <div className="max-w-6xl mx-auto px-6 pt-6">
          <div className="bg-blue-50 border border-blue-100 rounded-2xl px-6 py-4 text-sm text-blue-700 flex items-center justify-between">
            <span>Import your data from Google Sheets to get started.</span>
            <button onClick={()=>setShowImport(true)} className="ml-4 bg-blue-700 text-white px-4 py-1.5 rounded-lg text-xs hover:bg-blue-800">Import now</button>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* ── DASHBOARD ── */}
        {tab==="dashboard" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                {label:`Billing — ${billingLabel||"current"}`, value:fmt(totalBilling), sub:`${activeClients.length} active clients`},
                {label:`Next — ${nextLabel||"next month"}`, value:fmt(totalNext), sub:"projected"},
                {label:"Month-over-Month", value:(totalNext-totalBilling>=0?"+":"")+fmt(totalNext-totalBilling), sub:totalNext>=totalBilling?"increase":"decrease", color:totalNext>=totalBilling?"text-emerald-600":"text-red-500"},
                {label:"Pending Approval", value:pendingCount, sub:`${approvedCount} approved`},
              ].map(c=>(
                <div key={c.label} className="bg-white rounded-2xl p-5 border border-gray-100">
                  <p className="text-xs text-gray-400 mb-1">{c.label}</p>
                  <p className={`text-2xl font-semibold ${c.color||"text-gray-900"}`}>{c.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{c.sub}</p>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <h2 className="font-medium text-gray-800">Comparison: {billingLabel} vs {nextLabel}</h2>
              </div>
              {!clients.length ? <div className="px-6 py-10 text-center text-gray-300 text-sm">Import your data</div> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-400 border-b border-gray-50">
                    <th className="px-6 py-3 text-left">Client</th>
                    <th className="px-6 py-3 text-left">Lead</th>
                    <th className="px-6 py-3 text-left">Departments</th>
                    <th className="px-6 py-3 text-right">{billingLabel}</th>
                    <th className="px-6 py-3 text-right">{nextLabel}</th>
                    <th className="px-6 py-3 text-right">Change</th>
                    <th className="px-6 py-3 text-left">Status</th>
                  </tr></thead>
                  <tbody>
                    {activeClients.filter(c=>getClientAmt(c,billingMonth)>0||getClientAmt(c,nextColKey)>0).map(c=>{
                      const cur=getClientAmt(c,billingMonth), nxt=getClientAmt(c,nextColKey), diff=nxt-cur;
                      const inv=currentInvoices.find(i=>i.clientId===c.id);
                      const depts=[...new Set(c.lines.map(l=>l.department))].filter(Boolean);
                      return (
                        <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-3 font-medium text-gray-800">{c.name}</td>
                          <td className="px-6 py-3 text-xs text-gray-500">{c.lead||"—"}</td>
                          <td className="px-6 py-3"><div className="flex flex-wrap gap-1">{depts.map(d=><span key={d} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{d}</span>)}</div></td>
                          <td className="px-6 py-3 text-right text-gray-500">{fmt(cur)}</td>
                          <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(nxt)}</td>
                          <td className={`px-6 py-3 text-right font-medium ${diff>=0?"text-emerald-600":"text-red-500"}`}>{diff>=0?"+":""}{fmt(diff)}</td>
                          <td className="px-6 py-3">{inv&&<Badge status={inv.status}/>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── CLIENTS ── */}
        {tab==="clients" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-medium text-gray-800">Clients ({activeClients.length} active · {rawRows.length} service lines)</h2>
              <div className="flex gap-2 items-center">
                {monthCols.length>0&&(
                  <select value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none text-gray-600">
                    {monthCols.map(c=><option key={c.h} value={c.h}>{fmtMonthKey(c.h)}</option>)}
                  </select>
                )}
                <button onClick={()=>setShowAddClient(true)} className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700">+ Add Client</button>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2 text-xs text-blue-600">
              💡 Click any amount to edit it inline. Changes are saved automatically.
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {!clients.length ? <div className="px-6 py-10 text-center text-gray-300 text-sm">No clients — import your data</div> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-400 border-b border-gray-50">
                    <th className="px-6 py-3 text-left">Client</th>
                    <th className="px-6 py-3 text-left">Lead</th>
                    <th className="px-6 py-3 text-left">Services</th>
                    <th className="px-6 py-3 text-left">Departments</th>
                    <th className="px-6 py-3 text-right">{fmtMonthKey(selectedMonth)||billingLabel}</th>
                    <th className="px-6 py-3 text-left">QBO Lines</th>
                    <th className="px-6 py-3 text-left">Status</th>
                  </tr></thead>
                  <tbody>
                    {clients.map(c=>{
                      const services=[...new Set(c.lines.map(l=>l.service))].filter(Boolean);
                      const depts=[...new Set(c.lines.map(l=>l.department))].filter(Boolean);
                      return (
                        <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-3 font-medium text-gray-800">{c.name}</td>
                          <td className="px-6 py-3 text-xs text-gray-500">{c.lead||"—"}</td>
                          <td className="px-6 py-3 text-gray-500 text-xs">{services.join(", ")}</td>
                          <td className="px-6 py-3"><div className="flex flex-wrap gap-1">{depts.map(d=><span key={d} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{d}</span>)}</div></td>
                          <td className="px-6 py-3 text-right">
                            <EditAmt value={getClientAmt(c, selectedMonth||billingMonth)} onSave={v=>updateClientAmt(c.id, selectedMonth||billingMonth, v)} />
                          </td>
                          <td className="px-6 py-3 text-xs">{c.multiDept?<span className="text-blue-600">{depts.length} lines</span>:<span className="text-gray-400">1 line</span>}</td>
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-2">
                              <Badge status={c.status}/>
                              {c.status==="active"&&<button onClick={()=>setClients(p=>p.map(x=>x.id===c.id?{...x,status:"archived"}:x))} className="text-xs text-gray-300 hover:text-red-400">Archive</button>}
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

        {/* ── INVOICES ── */}
        {tab==="invoices" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-medium text-gray-800">Invoices — {billingLabel}</h2>
              {!qboConnected&&<p className="text-xs text-amber-600 bg-amber-50 px-3 py-1 rounded-full">Connect QBO to enable auto-send</p>}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {!currentInvoices.length ? <div className="px-6 py-10 text-center text-gray-300 text-sm">No invoices — import your data first</div> : (
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
                    {currentInvoices.map(inv=>{
                      const al=inv.lines?.filter(l=>(l.amounts?.[inv.monthCol]||0)>0)||[];
                      return (
                        <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-6 py-3">
                            <div className="font-medium text-gray-800">{inv.clientName}</div>
                            {al.length>0&&<button onClick={()=>setShowInvoiceDetail(inv)} className="text-xs text-blue-500 hover:underline">View {al.length} line{al.length>1?"s":""}</button>}
                          </td>
                          <td className="px-6 py-3 text-xs text-gray-500">{inv.lead||"—"}</td>
                          <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(inv.amount)}</td>
                          <td className="px-6 py-3 text-xs">{inv.multiDept?<span className="text-blue-600 font-medium">{[...new Set(inv.lines?.map(l=>l.department))].filter(Boolean).length} sep.</span>:<span className="text-gray-400">1 line</span>}</td>
                          <td className="px-6 py-3 text-gray-500 text-xs">{inv.approver||"—"}</td>
                          <td className="px-6 py-3"><Badge status={inv.status}/></td>
                          <td className="px-6 py-3 text-gray-400 text-xs italic">{inv.comment||"—"}</td>
                          <td className="px-6 py-3 text-right">
                            <div className="flex gap-2 justify-end">
                              {inv.status==="pending"&&<button onClick={()=>{setShowApprove(inv);setApproveComment("");}} className="text-xs bg-gray-900 text-white px-3 py-1 rounded-lg hover:bg-gray-700">Review</button>}
                              {inv.status==="see notes"&&<button onClick={()=>{setShowApprove(inv);setApproveComment(inv.comment);}} className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg hover:bg-orange-600">See Notes</button>}
                              {inv.status==="approved"&&qboConnected&&<button onClick={async()=>{const u=currentInvoices.map(i=>i.id===inv.id?{...i,status:"sent"}:i);const na={...allApprovals,[billingMonth]:u};setAllApprovals(na);triggerSave(null,na);}} className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700">Send via QBO</button>}
                              {inv.status==="approved"&&!qboConnected&&<span className="text-xs text-gray-300">Connect QBO</span>}
                              {inv.status==="rejected"&&<button onClick={async()=>{const u=currentInvoices.map(i=>i.id===inv.id?{...i,status:"pending",comment:""}:i);const na={...allApprovals,[billingMonth]:u};setAllApprovals(na);triggerSave(null,na);}} className="text-xs text-amber-600 border border-amber-200 px-3 py-1 rounded-lg hover:bg-amber-50">Resubmit</button>}
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

        {/* ── INVOICE APPROVALS ── */}
        {tab==="invoice approvals" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="font-medium text-gray-800">Invoice Approvals</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {fmtMonthKey(viewMonth)} billing → {fmtMonthKey(nextViewKey)||"next month"} projection
                  {!isViewingActive&&<span className="ml-2 bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-xs">Read-only archive</span>}
                </p>
              </div>
              {/* Month selector for approvals */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                  <span className="text-xs text-gray-400">Viewing:</span>
                  <select value={viewMonth} onChange={e=>setViewMonth(e.target.value)} className="text-xs font-medium text-gray-700 outline-none bg-transparent">
                    {Object.keys(allApprovals).sort().map(k=><option key={k} value={k}>{fmtMonthKey(k)}{k===billingMonth?" (active)":""}</option>)}
                  </select>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-full">{viewInvoices.filter(i=>i.nextAmount>0&&i.status==="pending").length} pending</span>
                  <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full">{viewInvoices.filter(i=>i.status==="approved").length} approved</span>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              {["all",...new Set(viewInvoices.filter(i=>i.nextAmount>0).map(i=>i.lead).filter(Boolean))].map(l=>(
                <button key={l} onClick={()=>setFilterLead(l)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterLead===l?"bg-gray-900 text-white":"bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                  {l==="all"?"All leads":l}
                </button>
              ))}
              <div className="w-px bg-gray-200 mx-1"/>
              {["all","pending","approved","see notes","rejected","sent"].map(s=>{
                const colors={all:"bg-gray-900 text-white",pending:"bg-amber-500 text-white",approved:"bg-blue-600 text-white","see notes":"bg-orange-500 text-white",rejected:"bg-red-500 text-white",sent:"bg-purple-600 text-white"};
                return (
                  <button key={s} onClick={()=>setFilterStatus(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${filterStatus===s?(colors[s]||"bg-gray-900 text-white"):"bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                    {s==="all"?"All statuses":s}
                  </button>
                );
              })}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {(() => {
                const rows = viewInvoices
                  .filter(i=>i.nextAmount>0)
                  .filter(i=>filterLead==="all"||i.lead===filterLead)
                  .filter(i=>filterStatus==="all"||i.status===filterStatus);
                if (!rows.length) return <div className="px-6 py-10 text-center text-gray-300 text-sm">{!viewInvoices.length?"No invoices for this month":"No invoices match the filters"}</div>;
                return (
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-gray-400 border-b border-gray-50">
                      <th className="px-6 py-3 text-left">Client</th>
                      <th className="px-6 py-3 text-left">Lead</th>
                      <th className="px-6 py-3 text-left">Departments</th>
                      <th className="px-6 py-3 text-right">{fmtMonthKey(viewMonth)||"Current"}</th>
                      <th className="px-6 py-3 text-right">{fmtMonthKey(nextViewKey)||"Next"}</th>
                      <th className="px-6 py-3 text-right">Change</th>
                      <th className="px-6 py-3 text-left">Status</th>
                      <th className="px-6 py-3 text-left">Comment</th>
                      {isViewingActive&&<th className="px-6 py-3"></th>}
                    </tr></thead>
                    <tbody>
                      {rows.map(inv=>{
                        const diff=inv.nextAmount-inv.amount;
                        const al=inv.lines?.filter(l=>(l.amounts?.[inv.nextMonthCol]||0)>0)||[];
                        const depts=[...new Set(inv.lines?.map(l=>l.department).filter(Boolean))];
                        return (
                          <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-6 py-3">
                              <div className="font-medium text-gray-800">{inv.clientName}</div>
                              {al.length>0&&<button onClick={()=>setShowInvoiceDetail({...inv,monthCol:inv.nextMonthCol,amount:inv.nextAmount})} className="text-xs text-blue-500 hover:underline">View {al.length} line{al.length>1?"s":""}</button>}
                            </td>
                            <td className="px-6 py-3 text-xs text-gray-500">{inv.lead||"—"}</td>
                            <td className="px-6 py-3"><div className="flex flex-wrap gap-1">{depts.map(d=><span key={d} className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{d}</span>)}</div></td>
                            <td className="px-6 py-3 text-right text-gray-500">{fmt(inv.amount)}</td>
                            <td className="px-6 py-3 text-right font-medium text-gray-800">{fmt(inv.nextAmount)}</td>
                            <td className={`px-6 py-3 text-right font-medium ${diff>=0?"text-emerald-600":"text-red-500"}`}>{diff>=0?"+":""}{fmt(diff)}</td>
                            <td className="px-6 py-3"><Badge status={inv.status}/></td>
                            <td className="px-6 py-3 text-gray-400 text-xs italic">{inv.comment||"—"}</td>
                            {isViewingActive&&(
                              <td className="px-6 py-3 text-right">
                                <div className="flex gap-2 justify-end">
                                  {inv.status==="pending"&&<button onClick={()=>{setShowApprove(inv);setApproveComment("");}} className="text-xs bg-gray-900 text-white px-3 py-1 rounded-lg hover:bg-gray-700">Review</button>}
                                  {inv.status==="see notes"&&<button onClick={()=>{setShowApprove(inv);setApproveComment(inv.comment);}} className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg hover:bg-orange-600">See Notes</button>}
                                  {inv.status==="approved"&&qboConnected&&<button onClick={async()=>{const u=viewInvoices.map(i=>i.id===inv.id?{...i,status:"sent"}:i);const na={...allApprovals,[viewMonth]:u};setAllApprovals(na);triggerSave(null,na);}} className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700">Send via QBO</button>}
                                  {inv.status==="approved"&&!qboConnected&&<span className="text-xs text-gray-300">Connect QBO</span>}
                                  {inv.status==="rejected"&&<button onClick={async()=>{const u=viewInvoices.map(i=>i.id===inv.id?{...i,status:"pending",comment:""}:i);const na={...allApprovals,[viewMonth]:u};setAllApprovals(na);triggerSave(null,na);}} className="text-xs text-amber-600 border border-amber-200 px-3 py-1 rounded-lg hover:bg-amber-50">Resubmit</button>}
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── AI ── */}
        {tab==="ai assistant" && (
          <div className="bg-white rounded-2xl border border-gray-100 flex flex-col" style={{height:"520px"}}>
            <div className="px-6 py-4 border-b border-gray-50">
              <h2 className="font-medium text-gray-800">AI Finance Assistant</h2>
              <p className="text-xs text-gray-400">Ask anything about clients, invoices, or performance</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {aiMessages.map((m,i)=>(
                <div key={i} className={`flex ${m.role==="user"?"justify-end":"justify-start"}`}>
                  <div className={`max-w-xs md:max-w-md px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${m.role==="user"?"bg-gray-900 text-white":"bg-gray-100 text-gray-800"}`}>{m.content}</div>
                </div>
              ))}
              {aiLoading&&<div className="flex justify-start"><div className="bg-gray-100 text-gray-400 px-4 py-2.5 rounded-2xl text-sm">Thinking…</div></div>}
              <div ref={chatEnd}/>
            </div>
            <div className="px-6 py-4 border-t border-gray-50 flex gap-3">
              <input value={aiInput} onChange={e=>setAiInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendAI()}
                placeholder="e.g. Which clients haven't been approved yet?" className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-gray-400"/>
              <button onClick={sendAI} disabled={aiLoading} className="bg-gray-900 text-white px-4 py-2 rounded-xl text-sm hover:bg-gray-700 disabled:opacity-40">Send</button>
            </div>
          </div>
        )}
      </div>

      {/* ── IMPORT MODAL ── */}
      {showImport&&(
        <Modal title="Import from Google Sheets" onClose={()=>setShowImport(false)} wide>
          <div className="space-y-4">
            <div className="flex rounded-xl overflow-hidden border border-gray-100">
              {["clients","leads"].map((s,idx)=>(
                <button key={s} onClick={()=>setImportStep(s)} className={`flex-1 py-2 text-sm font-medium transition-colors ${importStep===s?"bg-gray-900 text-white":"bg-gray-50 text-gray-500 hover:bg-gray-100"}`}>
                  {idx+1}. {s==="clients"?"Forecasted Revenues":"Leads (team)"}
                </button>
              ))}
            </div>
            {importStep==="clients"&&(
              <div className="space-y-3">
                <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                  <p className="font-medium">How to copy:</p>
                  <p>1. Open <strong>Forecasted Revenues</strong> tab</p>
                  <p>2. Click cell <strong>D1</strong> (Client Name header)</p>
                  <p>3. Select to last column/row with data</p>
                  <p>4. Copy and paste below</p>
                  <p className="text-blue-500">✓ Existing approval statuses are always preserved.</p>
                </div>
                <textarea value={clientPaste} onChange={e=>setClientPaste(e.target.value)}
                  placeholder={"Client Name\tService\tDepartment\t01/01/2025\t02/01/2025\nAcme Corp\tPaid\tCore Growth\t4500\t5000"}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono outline-none focus:border-gray-400 resize-none" rows={9}/>
                <button onClick={()=>setImportStep("leads")} disabled={!clientPaste.trim()} className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">Next: Paste team data</button>
              </div>
            )}
            {importStep==="leads"&&(
              <div className="space-y-3">
                <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                  <p className="font-medium">How to copy your team:</p>
                  <p>1. Open <strong>Leads</strong> tab</p>
                  <p>2. Select all including headers (<strong>Client</strong> and <strong>Lead</strong>)</p>
                  <p>3. Copy and paste below</p>
                </div>
                <textarea value={leadPaste} onChange={e=>setLeadPaste(e.target.value)}
                  placeholder={"Client\tLead\nAcme Corp\tSarah Johnson"}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono outline-none focus:border-gray-400 resize-none" rows={6}/>
                {importError&&<p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{importError}</p>}
                <div className="flex gap-3">
                  <button onClick={()=>setImportStep("clients")} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Back</button>
                  <button onClick={processImport} disabled={!clientPaste.trim()} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">Import data</button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── ADD CLIENT MODAL ── */}
      {showAddClient&&(
        <Modal title="Add New Client" onClose={()=>setShowAddClient(false)}>
          <div className="space-y-3">
            <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700">Added manually — won't affect your Google Sheet. Saved automatically.</div>
            {[["Client Name *","name","text"],["Service","service","text"],["Department","department","text"],["Lead","lead","text"]].map(([label,key,type])=>(
              <div key={key}>
                <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                <input type={type} value={newClient[key]} onChange={e=>setNewClient(p=>({...p,[key]:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"/>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{billingLabel||"Current"} ($)</label>
                <input type="number" value={newClient.currentAmt} onChange={e=>setNewClient(p=>({...p,currentAmt:e.target.value}))} placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{nextLabel||"Next"} ($)</label>
                <input type="number" value={newClient.nextAmt} onChange={e=>setNewClient(p=>({...p,nextAmt:e.target.value}))} placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"/>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={()=>{setShowAddClient(false);setNewClient({name:"",service:"",department:"",lead:"",currentAmt:"",nextAmt:""}); }} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={addClientManually} disabled={!newClient.name.trim()} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700 disabled:opacity-40">Add Client</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── CLOSE MONTH MODAL ── */}
      {showCloseMonth&&(
        <Modal title="Close Month & Open Next" onClose={()=>setShowCloseMonth(false)}>
          <div className="space-y-4">
            <div className="bg-amber-50 rounded-xl p-4 text-sm space-y-2">
              <p className="font-medium text-amber-800">You're about to close <strong>{billingLabel}</strong></p>
              <p className="text-amber-700 text-xs">All approvals for {billingLabel} will be <strong>archived</strong> and kept in history.</p>
              <p className="text-amber-700 text-xs">The billing month will move to <strong>{nextLabel||"next month"}</strong> with fresh pending invoices.</p>
              <p className="text-amber-700 text-xs">You can always view {billingLabel} approvals from the archive.</p>
            </div>
            {!nextColKey&&<p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">No next month found in your sheet. Import data with future month columns first.</p>}
            <div className="flex gap-3">
              <button onClick={()=>setShowCloseMonth(false)} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={closeMonth} disabled={!nextColKey} className="flex-1 bg-amber-500 text-white rounded-lg py-2 text-sm hover:bg-amber-600 disabled:opacity-40">Archive {billingLabel} → Open {nextLabel}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── INVOICE DETAIL MODAL ── */}
      {showInvoiceDetail&&(
        <Modal title={`Invoice lines — ${showInvoiceDetail.clientName}`} onClose={()=>setShowInvoiceDetail(null)} wide>
          <div className="space-y-3">
            <p className="text-xs text-gray-400">Month: {showInvoiceDetail.month} · {showInvoiceDetail.multiDept?"Separate QBO lines":"Single QBO line"}</p>
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="py-2 text-left">Service</th><th className="py-2 text-left">Department</th><th className="py-2 text-left">Lead</th><th className="py-2 text-right">Amount</th>
              </tr></thead>
              <tbody>
                {showInvoiceDetail.lines?.filter(l=>(l.amounts?.[showInvoiceDetail.monthCol]||0)>0).map((l,i)=>(
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-700">{l.service}</td>
                    <td className="py-2"><span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{l.department}</span></td>
                    <td className="py-2 text-xs text-gray-500">{l.lead||"—"}</td>
                    <td className="py-2 text-right font-medium text-gray-800">{fmt(l.amounts[showInvoiceDetail.monthCol])}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td colSpan={3} className="pt-3 text-sm font-medium text-gray-600">Total</td>
                <td className="pt-3 text-right font-semibold text-gray-900">{fmt(showInvoiceDetail.amount)}</td>
              </tr></tfoot>
            </table>
            <button onClick={()=>setShowInvoiceDetail(null)} className="w-full border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Close</button>
          </div>
        </Modal>
      )}

      {/* ── APPROVE MODAL ── */}
      {showApprove&&(
        <Modal title={`Review Invoice — ${showApprove.clientName}`} onClose={()=>setShowApprove(null)}>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between"><span className="text-gray-500">Client</span><span className="font-medium">{showApprove.clientName}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Lead</span><span>{showApprove.lead||"—"}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Current ({fmtMonthKey(viewMonth)})</span><span>{fmt(showApprove.amount)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Next ({fmtMonthKey(nextViewKey)})</span><span className="font-semibold">{fmt(showApprove.nextAmount)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">QBO lines</span><span>{showApprove.multiDept?`${[...new Set(showApprove.lines?.map(l=>l.department))].filter(Boolean).length} separate`:"1 line"}</span></div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Approver</label>
              <select value={showApprove.approver} onChange={e=>setShowApprove(p=>({...p,approver:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none">
                {(approvers.length?approvers:["—"]).map(a=><option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Comment (optional)</label>
              <textarea value={approveComment} onChange={e=>setApproveComment(e.target.value)} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none resize-none focus:border-gray-400"/>
            </div>
            <div className="flex gap-3">
              <button onClick={()=>approveInvoice("rejected")} className="flex-1 border border-red-200 text-red-600 rounded-lg py-2 text-sm hover:bg-red-50">Reject</button>
              <button onClick={()=>approveInvoice("see notes")} className="flex-1 border border-orange-200 text-orange-600 rounded-lg py-2 text-sm hover:bg-orange-50">See Notes</button>
              <button onClick={()=>approveInvoice("approved")} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm hover:bg-gray-700">Approve</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

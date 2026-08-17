
const firebaseConfig = {
  apiKey: "AIzaSyAA37hManUrwxtMNgQjhQA2bHkY9yFMLj0",
  authDomain: "points-tracker-29946.firebaseapp.com",
  projectId: "points-tracker-29946",
  storageBucket: "points-tracker-29946.firebasestorage.app",
  messagingSenderId: "210412447249",
  appId: "1:210412447249:web:9fa2d7c310bf72162d73b0"
};

let initializeApp, getFirestore, doc, getDoc, setDoc, collection, getDocs, deleteDoc, fbApp, db;
let fbReady = false;

async function initFirebase(){
  try{
    const [appModule, fsModule] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js")
    ]);
    initializeApp = appModule.initializeApp;
    getFirestore = fsModule.getFirestore;
    doc = fsModule.doc; getDoc = fsModule.getDoc; setDoc = fsModule.setDoc;
    collection = fsModule.collection; getDocs = fsModule.getDocs; deleteDoc = fsModule.deleteDoc;
    fbApp = initializeApp(firebaseConfig);
    db = getFirestore(fbApp);
    fbReady = true;
    return true;
  }catch(e){
    console.error("Firebase failed to load:", e);
    const statusEl = document.getElementById("syncGateStatus");
    if(statusEl) statusEl.textContent = "Couldn't load the sync service. Check your internet connection and reload this page.";
    const btn = document.getElementById("syncCodeSubmit");
    if(btn) btn.disabled = true;
    return false;
  }
}

let syncCode = null;

async function fbLoadMain(){
  if(!syncCode || !fbReady) return null;
  const snap = await getDoc(doc(db, "syncData", syncCode));
  return snap.exists() ? snap.data() : null;
}

async function fbSaveMain(data){
  if(!syncCode || !fbReady) return;
  await setDoc(doc(db, "syncData", syncCode), data);
}

async function fbLoadProofs(){
  if(!syncCode || !fbReady) return {};
  const map = {};
  const snap = await getDocs(collection(db, "syncData", syncCode, "proofs"));
  snap.forEach(d => { map[d.id] = d.data().data; });
  return map;
}

async function fbSaveProof(entryId, dataUrl){
  if(!syncCode || !fbReady) return;
  await setDoc(doc(db, "syncData", syncCode, "proofs", entryId), { data: dataUrl });
}

async function fbDeleteProof(entryId){
  if(!syncCode || !fbReady) return;
  try{ await deleteDoc(doc(db, "syncData", syncCode, "proofs", entryId)); }catch(e){}
}

const TARGETS_EUR = { "5": 7205, "10": 14410, "lol": 6500, "ow": 10000 };
const TARGETS_USD = { "5": 6500, "10": 13000, "lol": 6500, "ow": 10000 };
function isUSA(row){ return /^us/i.test((row.server || "").trim()); }
function targetPtsFor(row, overrideTarget){
  const key = overrideTarget || row.target;
  return (isUSA(row) ? TARGETS_USD : TARGETS_EUR)[key];
}
function currencySymbol(row){ return isUSA(row) ? "$" : "€"; }
function targetLabel(row, overrideTarget){
  const key = overrideTarget || row.target;
  if(key === "lol") return "575 RP";
  if(key === "ow") return "OW 1000";
  return (key === "10" ? "10" : "5") + currencySymbol(row);
}
function getSellPrice(row, overrideTarget){
  const key = overrideTarget || row.target;
  if(key === "lol" || key === "ow") return sellPrices[key] || 0;
  const currencyKey = key + (isUSA(row) ? "USD" : "EUR");
  return sellPrices[currencyKey] || 0;
}
const STORAGE_KEY = "pts-tracker-rows-v1";
const SETTINGS_KEY = "pts-tracker-settings-v1";
const REDEEM_LOG_KEY = "pts-tracker-redeemlog-v1";
const SELL_PRICES_KEY = "pts-tracker-sellprices-v1";

let rows = [];
let redeemLog = [];
let dailyPoints = 170;
let sortMode = "date";
let searchTerm = "";
let targetFilter = "all";
let monthFilter = "all";
let expanded = new Set();
let pendingRedeemId = null;
let pendingRedeemTimeout = null;
let previewTarget = null;
let bulkMode = false;
let bulkSelected = new Set();
let sellPrices = { "5EUR": 0, "5USD": 0, "10EUR": 0, "10USD": 0, "lol": 0, "ow": 0 };

let rlSearchTerm = "";
let rlSoldFilter = "all";
let rlTargetFilter = "all";
let rlMonthFilter = "all";
let rlServerFilter = "all";
let rlMissingFilter = null;
let rlSortMode = "date-desc";
let rlSoldSectionExpanded = false;
let rlExpanded = new Set();
let holdTimeout = null;
let holdBtnEl = null;
let confirmPendingEntryId = null;
let confirmPendingAction = null;
let confirmCountdownInterval = null;

function nowTimeStr(){
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function nextBonusLabel(row){
  const events = (row.extraEvents || []).filter(ev => ev.date > todayStr()).sort((a,b) => a.date.localeCompare(b.date));
  if(events.length === 0) return "";
  const ev = events[0];
  const shortDate = fmtDate(new Date(ev.date + "T00:00:00")).split(" ").slice(0,2).join(" ");
  return ` · next: +${ev.points} ${shortDate}`;
}

function performRedeem(row){
  const calc = computeRow(row);
  redeemLog.push({
    entryId: (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)),
    id: row.id,
    name: row.name,
    server: row.server || "",
    target: row.target,
    targetLabel: targetLabel(row),
    points: calc.targetPts,
    date: todayStr(),
    time: nowTimeStr(),
    code: "",
    codeLocked: false,
    proof: null,
    sold: false,
    soldDate: null,
    soldPrice: 0
  });
  const allEvents = Array.isArray(row.extraEvents) ? row.extraEvents : [];
  const carryEvents = allEvents.filter(ev => ev.date > todayStr());
  row.startPoints = 0;
  row.startDate = tomorrowStr();
  row.extraEvents = carryEvents;
  row.redeemed = false;
  row.redeemedDate = null;
  return { carriedCount: carryEvents.length };
}

function showToast(message){
  let toast = document.getElementById("appToast");
  if(!toast){
    toast = document.createElement("div");
    toast.id = "appToast";
    toast.className = "app-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toast.classList.remove("show"); }, 3500);
}

function todayStr(){
  return new Date().toISOString().slice(0,10);
}

function tomorrowStr(){
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0,10);
}

function defaultRows(){
  const arr = [];
  for(let i=1;i<=51;i++){
    arr.push({ id: i, name: "ID " + i, server: "", startPoints: 0, startDate: todayStr(), target: "5", extraEvents: [], dailyRate: null, redeemed: false, redeemedDate: null });
  }
  for(let i=52;i<=66;i++){
    arr.push({ id: i, name: "ID " + i, server: "USA", startPoints: 0, startDate: todayStr(), target: "5", extraEvents: [], dailyRate: i === 52 ? 200 : null, redeemed: false, redeemedDate: null });
  }
  return arr;
}

function ensureFullRoster(){
  // migrate older saves up to the current 66 roster
  const existingIds = new Set(rows.map(r => r.id));
  for(let i=1;i<=51;i++){
    if(!existingIds.has(i)) rows.push({ id:i, name:"ID "+i, server:"", startPoints:0, startDate:todayStr(), target:"5", extraEvents:[], dailyRate:null, redeemed:false, redeemedDate:null });
  }
  for(let i=52;i<=66;i++){
    if(!existingIds.has(i)) rows.push({ id:i, name:"ID "+i, server:"USA", startPoints:0, startDate:todayStr(), target:"5", extraEvents:[], dailyRate: i===52?200:null, redeemed:false, redeemedDate:null });
  }
  rows.sort((a,b) => a.id - b.id);
}

function normalizeRows(){
  // fill in fields for rows saved before extra/dailyRate/redeemed existed
  rows.forEach(r => {
    if(!Array.isArray(r.extraEvents)){
      r.extraEvents = [];
      const legacyExtra = Number(r.extra || (r.bonus ? r.bonus * 1000 : 0));
      if(legacyExtra > 0){
        r.extraEvents.push({ id: "legacy-" + r.id, date: todayStr(), points: legacyExtra });
      }
    }
    delete r.extra;
    if(typeof r.dailyRate === "undefined" || r.dailyRate === null){
      r.dailyRate = (r.id === 52) ? 200 : null;
    }
    if(typeof r.redeemed === "undefined") r.redeemed = false;
    if(typeof r.redeemedDate === "undefined") r.redeemedDate = null;
    delete r.bonus;
  });
}

const PRESET_NAMES = {
  1:{name:"Marenbosch12@",server:"DE#217"}, 2:{name:"Brentmarquez@",server:"DE#422"},
  3:{name:"Noahbaumann95@",server:"DE#603"}, 4:{name:"Veraheim97@",server:"DE#822"},
  5:{name:"Albersmitht911@",server:"DE#258"}, 6:{name:"Licameier121@",server:"DE#803"},
  7:{name:"Annafrei04@",server:"DE#1"}, 8:{name:"Fischerjonas860@",server:"DE#442"},
  9:{name:"Leonhartmann273@",server:"DE#213"}, 10:{name:"Donnabutler358@",server:"DE#257"},
  11:{name:"Thomasbrandon9578@",server:"DE#842"}, 12:{name:"Oliverkrause00@",server:"DE#600"},
  13:{name:"Stenfanrichter842@",server:"DE#23"}, 14:{name:"Helenewessel365@",server:"DE#656"},
  15:{name:"Kevinschulz1013@",server:"DE#507"}, 16:{name:"Albinhansen3@",server:"DE#753"},
  17:{name:"Milanbrenner@z",server:"DE#818"}, 18:{name:"Estellaarias83@",server:"DE#536"},
  19:{name:"Dietlindebuchner819@",server:"DE#232"}, 20:{name:"karinbrand208@",server:"DE#895"},
  21:{name:"Kimdiehl412@gmail.com",server:"DE#368"}, 22:{name:"Jannabarber902@",server:"DE#899"},
  23:{name:"Johnsonthomas64x@",server:"DE#468"}, 24:{name:"Hartunghagen69@",server:"DE#905"},
  25:{name:"Norascholl9@gmail.com",server:"DE#737"}, 26:{name:"Juliaweber9126@",server:"DW#462"},
  27:{name:"robinward238@gmail.com",server:"DE#229"}, 28:{name:"jakobgreiner21@gmail.com",server:"DE#444"},
  29:{name:"Kurtparrish11@gmail.com",server:"DE#723"}, 30:{name:"Arndstrauch@zohomail.in",server:"DE#859"},
  31:{name:"Aloysnoll333@proton.me",server:"DE#333"}, 32:{name:"Stevenstarke@proton.me",server:"DE#555"},
  33:{name:"gilbertolynch156@gmail.com",server:"DE#804"}, 34:{name:"Kimramos888@proton.me",server:"DE#888"},
  35:{name:"Piaadams@proton.me",server:"DE#777"}, 36:{name:"Jewelwatson779@gmail.com",server:"DE#779"},
  37:{name:"Renaterath@proton.me",server:"DE#766"}, 38:{name:"Alanahill846@proton.me",server:"DE#846"},
  39:{name:"philipdietrich432@proton.me",server:"DE#432"}, 40:{name:"doraschwarze@proton.me",server:"DE#499"},
  41:{name:"lidiakonrad@proton.me",server:"DE#437"}, 42:{name:"elisehaller349@proton.me",server:"DE#349"},
  43:{name:"katrinjost725@proton.me",server:"DE#725"}, 44:{name:"Angelastumpf625@proton",server:"DE#625"},
  45:{name:"Jungaser525@proton.me",server:"DE#525"}, 46:{name:"Willihoman325@proton.me",server:"DE#621"},
  48:{name:"Sandraworner829@proton.me",server:"DE#829"},
  52:{name:"christhomas619@Proton.me",server:"US-TX#716"}, 53:{name:"Charlottevance85@proton.me",server:"US-NY#719"}
};

function applyPresetNames(){
  rows.forEach(r => {
    const preset = PRESET_NAMES[r.id];
    if(!preset) return;
    const prefixedName = r.id + ") " + preset.name;
    if(r.name === "ID " + r.id || r.name === preset.name){
      r.name = prefixedName;
      if(!r.server || r.server === "USA") r.server = preset.server;
    }
  });
}

function daysElapsed(startDate){
  const start = new Date(startDate + "T00:00:00");
  const now = new Date();
  now.setHours(0,0,0,0);
  const diff = Math.floor((now - start) / (1000*60*60*24));
  return Math.max(diff, 0);
}

function stripProofsForStorage(log){
  return log.map(e => {
    const copy = Object.assign({}, e);
    copy.hasProof = !!copy.proof;
    delete copy.proof;
    return copy;
  });
}

let saveMainTimeout = null;
async function saveMainDoc(){
  if(!syncCode) return;
  clearTimeout(saveMainTimeout);
  return new Promise((resolve) => {
    saveMainTimeout = setTimeout(async () => {
      try{
        await fbSaveMain({
          rows: JSON.stringify(rows),
          dailyPoints,
          redeemLog: JSON.stringify(stripProofsForStorage(redeemLog)),
          sellPrices: JSON.stringify(sellPrices),
          updatedAt: Date.now()
        });
      }catch(e){
        console.error(e);
        showToast("Sync failed — check your connection and try again.");
      }
      resolve();
    }, 400);
  });
}

async function loadData(){
  const main = await fbLoadMain();

  if(main){
    try{ rows = main.rows ? JSON.parse(main.rows) : defaultRows(); }catch(e){ rows = defaultRows(); }
    dailyPoints = main.dailyPoints || 170;
    try{ redeemLog = main.redeemLog ? JSON.parse(main.redeemLog) : []; }catch(e){ redeemLog = []; }
    try{
      const parsed = main.sellPrices ? JSON.parse(main.sellPrices) : {};
      if(typeof parsed["5"] !== "undefined" && typeof parsed["5EUR"] === "undefined"){
        parsed["5EUR"] = parsed["5"]; parsed["5USD"] = parsed["5"];
      }
      if(typeof parsed["10"] !== "undefined" && typeof parsed["10EUR"] === "undefined"){
        parsed["10EUR"] = parsed["10"]; parsed["10USD"] = parsed["10"];
      }
      sellPrices = Object.assign(sellPrices, parsed);
    }catch(e){ /* keep defaults */ }
  }else{
    rows = defaultRows();
    redeemLog = [];
  }

  ensureFullRoster();
  normalizeRows();
  applyPresetNames();

  redeemLog.forEach(entry => {
    if(typeof entry.sold === "undefined") entry.sold = false;
    if(typeof entry.soldDate === "undefined") entry.soldDate = null;
    if(typeof entry.soldPrice === "undefined") entry.soldPrice = 0;
    if(typeof entry.code === "undefined") entry.code = "";
    if(typeof entry.proof === "undefined") entry.proof = null;
    if(typeof entry.codeLocked === "undefined") entry.codeLocked = !!entry.code;
  });

  try{
    const proofMap = await fbLoadProofs();
    redeemLog.forEach(entry => {
      if(proofMap[entry.entryId]) entry.proof = proofMap[entry.entryId];
    });
  }catch(e){ console.error(e); }

  document.getElementById("sellPrice5EUR").value = sellPrices["5EUR"] || "";
  document.getElementById("sellPrice5USD").value = sellPrices["5USD"] || "";
  document.getElementById("sellPrice10EUR").value = sellPrices["10EUR"] || "";
  document.getElementById("sellPrice10USD").value = sellPrices["10USD"] || "";
  document.getElementById("sellPriceLol").value = sellPrices["lol"] || "";
  document.getElementById("sellPriceOw").value = sellPrices["ow"] || "";
  document.getElementById("dailyPoints").value = dailyPoints;
  await saveRows();
  render();
}

async function saveSellPrices(){ await saveMainDoc(); }
async function saveRows(){ await saveMainDoc(); }
async function saveSettings(){ await saveMainDoc(); }
async function saveRedeemLog(){ await saveMainDoc(); }

const BONUS_DAY_AMOUNT = 420;
function isBonusDate(d){
  return d.getDate() === 3;
}
function countBonusDays(startDate, endDateInclusive){
  // counts bonus days strictly after startDate, up to and including endDateInclusive
  let count = 0;
  const cur = new Date(startDate);
  cur.setDate(cur.getDate() + 1);
  while(cur <= endDateInclusive){
    if(isBonusDate(cur)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function computeRow(row, overrideTarget){
  const targetPts = targetPtsFor(row, overrideTarget);
  const start = new Date(row.startDate + "T00:00:00");
  const today = new Date();
  today.setHours(0,0,0,0);
  const elapsed = daysElapsed(row.startDate);
  const rate = (row.dailyRate && Number(row.dailyRate) > 0) ? Number(row.dailyRate) : dailyPoints;

  const bonusSoFar = countBonusDays(start, today) * BONUS_DAY_AMOUNT;
  const events = Array.isArray(row.extraEvents) ? row.extraEvents : [];
  const todayISO = todayStr();
  const extraSoFar = events
    .filter(ev => ev.date <= todayISO)
    .reduce((sum, ev) => sum + Number(ev.points || 0), 0);

  const todayPoints = Number(row.startPoints || 0) + (elapsed * rate) + bonusSoFar;
  const effective = todayPoints + extraSoFar;
  const remaining = Math.max(targetPts - effective, 0);

  let daysNeeded = 0;
  const completion = new Date(today);
  if(remaining > 0){
    let pts = effective;
    const cursor = new Date(today);
    const SAFETY_CAP = 3650;
    while(pts < targetPts && daysNeeded < SAFETY_CAP){
      cursor.setDate(cursor.getDate() + 1);
      daysNeeded++;
      pts += rate;
      if(isBonusDate(cursor)) pts += BONUS_DAY_AMOUNT;
      const cursorISO = cursor.toISOString().slice(0,10);
      const futureExtra = events
        .filter(ev => ev.date === cursorISO)
        .reduce((sum, ev) => sum + Number(ev.points || 0), 0);
      pts += futureExtra;
    }
    completion.setTime(cursor.getTime());
  }
  return { targetPts, effective, todayPoints, remaining, daysNeeded, completion, rate, extraSoFar };
}

function fmtDate(d){
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function monthKey(d){
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function monthLabel(key){
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month:'long', year:'numeric' });
}

function populateMonthFilter(display){
  const sel = document.getElementById("monthFilter");
  if(!sel) return;
  const months = Array.from(new Set(display.map(d => monthKey(d.calc.completion)))).sort();
  const current = sel.value || "all";
  const optionsHtml = ['<option value="all">All Months</option>']
    .concat(months.map(k => `<option value="${k}">${monthLabel(k)}</option>`));
  const newHtml = optionsHtml.join("");
  if(sel.innerHTML !== newHtml) sel.innerHTML = newHtml;
  sel.value = months.includes(current) || current === "all" ? current : "all";
}

function render(){
  renderStats();
  const list = document.getElementById("list");
  list.innerHTML = "";

  const banner = document.getElementById("previewBanner");
  if(previewTarget){
    banner.classList.remove("hidden");
    document.getElementById("previewLabel").textContent =
      previewTarget === "lol" ? "575 RP" : previewTarget === "ow" ? "OW 1000" : (previewTarget + "€/$");
  }else{
    banner.classList.add("hidden");
  }

  let display = rows.map(r => ({ row: r, calc: computeRow(r, previewTarget) }));

  populateMonthFilter(display);

  if(searchTerm){
    const q = searchTerm.toLowerCase();
    display = display.filter(d =>
      d.row.name.toLowerCase().includes(q) ||
      (d.row.server || "").toLowerCase().includes(q) ||
      String(d.row.id).includes(q)
    );
  }

  if(targetFilter !== "all"){
    display = display.filter(d => d.row.target === targetFilter);
  }

  if(monthFilter !== "all"){
    display = display.filter(d => monthKey(d.calc.completion) === monthFilter);
  }

  display.sort((a,b) => {
    if(a.row.redeemed !== b.row.redeemed) return a.row.redeemed ? 1 : -1;
    if(sortMode === "date") return a.calc.completion - b.calc.completion;
    if(sortMode === "date-desc") return b.calc.completion - a.calc.completion;
    if(sortMode === "remaining") return a.calc.remaining - b.calc.remaining;
    if(sortMode === "progress") return (b.calc.effective / b.calc.targetPts) - (a.calc.effective / a.calc.targetPts);
    if(sortMode === "name") return a.row.name.localeCompare(b.row.name);
    return 0;
  });

  display.forEach(({row, calc}) => {
    const card = document.createElement("div");
    card.id = "card-" + row.id;
    card.className = "row-card" + (calc.remaining === 0 || row.redeemed ? " done" : "") + (!row.redeemed && calc.remaining > 0 && calc.daysNeeded <= 3 ? " soon" : "");
    const isOpen = expanded.has(row.id);
    card.innerHTML = `
      <div class="row-summary">
        ${bulkMode && !row.redeemed && calc.remaining === 0 ? `<input type="checkbox" class="bulk-checkbox" data-bulkid="${row.id}" ${bulkSelected.has(row.id) ? 'checked' : ''}>` : ''}
        <input class="name" value="${escapeHtml(row.name)}" data-id="${row.id}" data-field="name">
        <div class="summary-right">
          <span class="mini-badge ${row.redeemed ? 'redeemed' : (calc.remaining===0?'done':'pending')}">${row.redeemed ? 'Redeemed' : (calc.remaining===0 ? 'Today' : fmtDate(calc.completion))}</span>
          <button class="chevron" data-id="${row.id}" data-action="toggle" type="button">${isOpen ? '︿' : '﹀'}</button>
        </div>
      </div>
      <div class="meta-line">${row.server ? escapeHtml(row.server) + ' · ' : ''}${targetLabel(row, previewTarget)}${row.redeemed ? ' · redeemed' : (calc.remaining === 0 ? ' · target reached' : ' · ' + calc.daysNeeded + ' days left · ' + calc.remaining + ' pts left')}${nextBonusLabel(row)}</div>
      <div class="details ${isOpen ? '' : 'hidden'}">
        <button class="redeem-btn" type="button" data-id="${row.id}" data-action="redeemNow">Mark Redeemed & Reset</button>
        <div class="row-grid">
          <div class="mini-field">
            <label>Server</label>
            <input type="text" value="${escapeHtml(row.server||'')}" data-id="${row.id}" data-field="server" placeholder="e.g. IN">
          </div>
          <div class="mini-field">
            <label>Target</label>
            <select data-id="${row.id}" data-field="target">
              <option value="5" ${row.target==='5'?'selected':''}>${isUSA(row) ? '5$ — 6500 pts' : '5€ — 7205 pts'}</option>
              <option value="10" ${row.target==='10'?'selected':''}>${isUSA(row) ? '10$ — 13000 pts' : '10€ — 14410 pts'}</option>
              <option value="lol" ${row.target==='lol'?'selected':''}>575 RP (LoL) — 6500 pts</option>
              <option value="ow" ${row.target==='ow'?'selected':''}>Overwatch 1000 — 10000 pts</option>
            </select>
          </div>
          <div class="mini-field">
            <label>Start Points</label>
            <input type="number" value="${row.startPoints}" data-id="${row.id}" data-field="startPoints">
          </div>
          <div class="mini-field">
            <label>Start Date</label>
            <input type="date" value="${row.startDate}" data-id="${row.id}" data-field="startDate">
          </div>
          <div class="mini-field">
            <label>Daily Rate</label>
            <input type="number" value="${row.dailyRate || ''}" data-id="${row.id}" data-field="dailyRate" placeholder="${dailyPoints} (default)">
          </div>
        </div>
        <div class="extra-events">
          <label>Scheduled Extra Points</label>
          <div class="extra-list">
            ${(row.extraEvents || []).length === 0
              ? '<div class="extra-empty">No scheduled bonuses</div>'
              : [...row.extraEvents].sort((a,b) => a.date.localeCompare(b.date)).map(ev => `
                <div class="extra-item ${ev.date <= todayStr() ? 'arrived' : ''}">
                  <span class="extra-date">${fmtDate(new Date(ev.date + "T00:00:00"))}${ev.date <= todayStr() ? ' · added' : ''}</span>
                  <span class="extra-pts">+${ev.points} pts</span>
                  <button type="button" class="extra-remove" data-id="${row.id}" data-eventid="${ev.id}" data-action="removeExtraEvent">✕</button>
                </div>
              `).join("")
            }
          </div>
          <div class="extra-add-row">
            <input type="date" class="extra-date-input" id="extraDate-${row.id}">
            <input type="number" class="extra-pts-input" id="extraPts-${row.id}" placeholder="Points">
            <button type="button" class="action secondary rl-mini-btn" data-id="${row.id}" data-action="addExtraEvent">Add</button>
          </div>
        </div>
        <div class="row-bottom">
          <div class="date-block">
            ${row.redeemed
              ? `<div class="date">Redeemed</div><div class="sub">on ${row.redeemedDate ? fmtDate(new Date(row.redeemedDate + "T00:00:00")) : "—"}</div>`
              : `<div class="date">${calc.remaining===0 ? 'Today' : fmtDate(calc.completion)}</div><div class="sub">${calc.remaining} pts remaining · ${calc.effective} / ${calc.targetPts} today</div>`
            }
          </div>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
  updateBulkBar();
}

function updateBulkBar(){
  const bar = document.getElementById("bulkBar");
  const label = document.getElementById("bulkCountLabel");
  if(!bar || !label) return;
  if(bulkMode && bulkSelected.size > 0){
    bar.classList.remove("hidden");
    label.textContent = `${bulkSelected.size} selected`;
  }else{
    bar.classList.add("hidden");
  }
}

function renderStats(){
  const pairs = rows.map(r => ({ r, c: computeRow(r, previewTarget) }));
  const completedCount = pairs.filter(p => !p.r.redeemed && p.c.remaining === 0).length;
  const nextArr = pairs.filter(p => !p.r.redeemed && p.c.remaining > 0).sort((a,b) => a.c.completion - b.c.completion);
  const next = nextArr[0];

  const soldEntries = redeemLog.filter(e => e.sold);
  const totalEarned = soldEntries.reduce((sum, e) => sum + Number(e.soldPrice || 0), 0);
  const thisMonthKey = todayStr().slice(0,7);
  const monthEarned = soldEntries
    .filter(e => e.soldDate && e.soldDate.slice(0,7) === thisMonthKey)
    .reduce((sum, e) => sum + Number(e.soldPrice || 0), 0);

  const stats = document.getElementById("stats");
  stats.innerHTML = `
    <div class="stat"><div class="num">${completedCount}/66</div><div class="lbl">Target Reached</div></div>
    <div class="stat"><div class="num">₹${totalEarned}</div><div class="lbl">Total Earned</div></div>
    <div class="stat"><div class="num">${next ? fmtDate(next.c.completion).split(' ').slice(0,2).join(' ') : '—'}</div><div class="lbl">Next Completion</div></div>
    <div class="stat"><div class="num">${dailyPoints}</div><div class="lbl">Default Pts/Day</div></div>
  `;
  const earningsNote = document.getElementById("earningsNote");
  if(earningsNote){
    earningsNote.textContent = `This month: ₹${monthEarned} · ${soldEntries.length} sold total`;
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function updateCardDisplay(rowId){
  const row = rows.find(r => r.id === rowId);
  if(!row) return;
  const calc = computeRow(row, previewTarget);
  const card = document.getElementById("card-" + rowId);
  if(!card) return;
  card.classList.toggle("done", calc.remaining === 0 || row.redeemed);
  card.classList.toggle("soon", !row.redeemed && calc.remaining > 0 && calc.daysNeeded <= 3);

  const miniBadge = card.querySelector(".mini-badge");
  miniBadge.className = "mini-badge " + (row.redeemed ? "redeemed" : (calc.remaining === 0 ? "done" : "pending"));
  miniBadge.textContent = row.redeemed ? "Redeemed" : (calc.remaining === 0 ? "Today" : fmtDate(calc.completion));

  const meta = card.querySelector(".meta-line");
  meta.textContent = (row.server ? row.server + " · " : "") + targetLabel(row, previewTarget) +
    (row.redeemed ? " · redeemed" : (calc.remaining === 0 ? " · target reached" : " · " + calc.daysNeeded + " days left · " + calc.remaining + " pts left")) +
    nextBonusLabel(row);

  const dateEl = card.querySelector(".date");
  const subEl = card.querySelector(".sub");
  if(dateEl && subEl && !row.redeemed){
    dateEl.textContent = calc.remaining === 0 ? "Today" : fmtDate(calc.completion);
    subEl.textContent = calc.remaining + " pts remaining · " + calc.effective + " / " + calc.targetPts + " today";
  }
}

// Typing: update data + just this card's numbers, without rebuilding the list (keeps keyboard open)
document.getElementById("list").addEventListener("input", (e) => {
  const id = Number(e.target.dataset.id);
  const field = e.target.dataset.field;
  if(!id || !field) return;
  const row = rows.find(r => r.id === id);
  if(!row) return;

  if(field === "redeemed"){
    row.redeemed = e.target.checked;
    row.redeemedDate = row.redeemed ? todayStr() : null;
    saveRows();
    render();
    return;
  }

  if(field === "startPoints") row.startPoints = Number(e.target.value) || 0;
  else if(field === "startDate") row.startDate = e.target.value;
  else if(field === "server") row.server = e.target.value;
  else if(field === "name") row.name = e.target.value;
  else if(field === "target") row.target = e.target.value;
  else if(field === "dailyRate") row.dailyRate = e.target.value === "" ? null : Number(e.target.value);
  saveRows();
  updateCardDisplay(id);
  renderStats();
});

// Done editing (tap away / confirm date / pick dropdown): safe to fully re-sort and rebuild
// (skip the ephemeral "add scheduled bonus" inputs — they aren't saved row data,
// and re-rendering here would wipe them before the Add button is tapped)
document.getElementById("list").addEventListener("change", (e) => {
  if(e.target.classList.contains("extra-date-input") || e.target.classList.contains("extra-pts-input")) return;
  if(e.target.classList.contains("bulk-checkbox")){
    const id = Number(e.target.dataset.bulkid);
    if(e.target.checked) bulkSelected.add(id); else bulkSelected.delete(id);
    updateBulkBar();
    return;
  }
  render();
});

document.getElementById("list").addEventListener("click", (e) => {
  const action = e.target.dataset.action;
  if(!action) return;
  const id = Number(e.target.dataset.id);
  const row = rows.find(r => r.id === id);
  if(!row) return;
  if(action === "toggle"){
    if(expanded.has(id)) expanded.delete(id); else expanded.add(id);
    render();
    return;
  }
  if(action === "addExtraEvent"){
    const dateInput = document.getElementById("extraDate-" + id);
    const ptsInput = document.getElementById("extraPts-" + id);
    const date = dateInput ? dateInput.value : "";
    const points = ptsInput ? Number(ptsInput.value) : 0;
    if(!date || !points || points <= 0){
      alert("Pick a date and enter a positive points amount.");
      return;
    }
    if(!Array.isArray(row.extraEvents)) row.extraEvents = [];
    row.extraEvents.push({
      id: (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)),
      date,
      points
    });
    saveRows();
    render();
    return;
  }
  if(action === "removeExtraEvent"){
    const eventId = e.target.dataset.eventid;
    row.extraEvents = (row.extraEvents || []).filter(ev => ev.id !== eventId);
    saveRows();
    render();
    return;
  }
  if(action === "redeemNow"){
    if(pendingRedeemId === id){
      const result = performRedeem(row);
      pendingRedeemId = null;
      clearTimeout(pendingRedeemTimeout);
      saveRedeemLog();
      saveRows();
      render();
      if(result.carriedCount > 0){
        showToast(`Redeemed — ${result.carriedCount} scheduled bonus${result.carriedCount > 1 ? 'es' : ''} carried over to the new cycle.`);
      }
      return;
    } else {
      pendingRedeemId = id;
      e.target.textContent = "Tap again to confirm";
      e.target.classList.add("confirm-pending");
      clearTimeout(pendingRedeemTimeout);
      pendingRedeemTimeout = setTimeout(() => {
        pendingRedeemId = null;
        e.target.textContent = "Mark Redeemed & Reset";
        e.target.classList.remove("confirm-pending");
      }, 4000);
      return;
    }
  }
  saveRows();
  render();
});

document.getElementById("dailyPoints").addEventListener("input", (e) => {
  dailyPoints = Number(e.target.value) || 1;
  saveSettings();
  render();
});

document.getElementById("search").addEventListener("input", (e) => {
  searchTerm = e.target.value;
  render();
});

document.querySelectorAll(".chip[data-target]").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip[data-target]").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    targetFilter = chip.dataset.target;
    render();
  });
});

document.querySelectorAll(".chip[data-preview]").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip[data-preview]").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    previewTarget = chip.dataset.preview === "none" ? null : chip.dataset.preview;
    render();
  });
});

document.getElementById("monthFilter").addEventListener("change", (e) => {
  monthFilter = e.target.value;
  render();
});

document.querySelectorAll(".chip[data-sort]").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip[data-sort]").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    sortMode = chip.dataset.sort;
    render();
  });
});

document.getElementById("expandAllChip").addEventListener("click", () => {
  rows.forEach(r => expanded.add(r.id));
  render();
});
document.getElementById("collapseAllChip").addEventListener("click", () => {
  expanded.clear();
  render();
});

let bulkConfirmPending = false;
let bulkConfirmTimeout = null;

document.getElementById("bulkModeChip").addEventListener("click", () => {
  bulkMode = !bulkMode;
  bulkSelected.clear();
  bulkConfirmPending = false;
  clearTimeout(bulkConfirmTimeout);
  document.getElementById("bulkModeChip").classList.toggle("active", bulkMode);
  document.getElementById("bulkRedeemBtn").textContent = "Redeem Selected";
  render();
});

document.getElementById("bulkRedeemBtn").addEventListener("click", (e) => {
  if(bulkSelected.size === 0) return;
  if(!bulkConfirmPending){
    bulkConfirmPending = true;
    e.target.textContent = "Tap again to confirm";
    clearTimeout(bulkConfirmTimeout);
    bulkConfirmTimeout = setTimeout(() => {
      bulkConfirmPending = false;
      e.target.textContent = "Redeem Selected";
    }, 4000);
    return;
  }
  clearTimeout(bulkConfirmTimeout);
  bulkConfirmPending = false;
  let totalCarried = 0;
  const ids = Array.from(bulkSelected);
  ids.forEach(id => {
    const row = rows.find(r => r.id === id);
    if(row){
      const result = performRedeem(row);
      totalCarried += result.carriedCount;
    }
  });
  bulkSelected.clear();
  bulkMode = false;
  document.getElementById("bulkModeChip").classList.remove("active");
  saveRedeemLog();
  saveRows();
  render();
  showToast(`Redeemed ${ids.length} account${ids.length > 1 ? 's' : ''}${totalCarried > 0 ? ` — ${totalCarried} bonus${totalCarried > 1 ? 'es' : ''} carried over` : ''}.`);
});

document.getElementById("toolsToggleBtn").addEventListener("click", () => {
  document.getElementById("toolsPanel").classList.toggle("hidden");
});

document.getElementById("redeemLogBtn").addEventListener("click", () => {
  document.getElementById("redeemLogPanel").classList.toggle("hidden");
  document.getElementById("sellPricesPanel").classList.add("hidden");
  renderRedeemLog();
});

document.getElementById("redeemLogCloseBtn").addEventListener("click", () => {
  document.getElementById("redeemLogPanel").classList.add("hidden");
});

document.getElementById("sellPricesBtn").addEventListener("click", () => {
  document.getElementById("sellPricesPanel").classList.toggle("hidden");
  document.getElementById("redeemLogPanel").classList.add("hidden");
});

document.getElementById("sellPricesCloseBtn").addEventListener("click", () => {
  document.getElementById("sellPricesPanel").classList.add("hidden");
});

document.getElementById("sellPricesSaveBtn").addEventListener("click", () => {
  sellPrices["5EUR"] = Number(document.getElementById("sellPrice5EUR").value) || 0;
  sellPrices["5USD"] = Number(document.getElementById("sellPrice5USD").value) || 0;
  sellPrices["10EUR"] = Number(document.getElementById("sellPrice10EUR").value) || 0;
  sellPrices["10USD"] = Number(document.getElementById("sellPrice10USD").value) || 0;
  sellPrices["lol"] = Number(document.getElementById("sellPriceLol").value) || 0;
  sellPrices["ow"] = Number(document.getElementById("sellPriceOw").value) || 0;
  saveSellPrices();
  showToast("Sell prices saved.");
  document.getElementById("sellPricesPanel").classList.add("hidden");
});

function populateRlMonthFilter(){
  const sel = document.getElementById("rlMonthFilter");
  if(!sel) return;
  const months = Array.from(new Set(redeemLog.map(e => e.date.slice(0,7)))).sort();
  const current = sel.value || "all";
  const optionsHtml = ['<option value="all">All Months</option>']
    .concat(months.map(k => `<option value="${k}">${monthLabel(k)}</option>`));
  const newHtml = optionsHtml.join("");
  if(sel.innerHTML !== newHtml) sel.innerHTML = newHtml;
  sel.value = months.includes(current) || current === "all" ? current : "all";
}

function populateRlServerFilter(){
  const sel = document.getElementById("rlServerFilter");
  if(!sel) return;
  const servers = Array.from(new Set(redeemLog.map(e => (e.server || "").trim()).filter(Boolean))).sort();
  const current = sel.value || "all";
  const optionsHtml = ['<option value="all">All Servers</option>']
    .concat(servers.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`));
  const newHtml = optionsHtml.join("");
  if(sel.innerHTML !== newHtml) sel.innerHTML = newHtml;
  sel.value = servers.includes(current) || current === "all" ? current : "all";
}

function daysSince(dateStr){
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0,0,0,0);
  return Math.floor((today - d) / 86400000);
}

function sortEntries(list){
  const arr = [...list];
  if(rlSortMode === "date-desc") arr.sort((a,b) => b.date.localeCompare(a.date));
  else if(rlSortMode === "date-asc") arr.sort((a,b) => a.date.localeCompare(b.date));
  else if(rlSortMode === "points-desc") arr.sort((a,b) => b.points - a.points);
  else if(rlSortMode === "points-asc") arr.sort((a,b) => a.points - b.points);
  else if(rlSortMode === "name") arr.sort((a,b) => (a.name || "").localeCompare(b.name || ""));
  return arr;
}

function fmtEntryDateTime(entry){
  const dateLabel = fmtDate(new Date(entry.date + "T00:00:00"));
  return entry.time ? `${dateLabel} · ${entry.time}` : dateLabel;
}

function renderEntryCard(entry){
  const isOpen = rlExpanded.has(entry.entryId);

  const codeRow = (entry.codeLocked && entry.code)
    ? `<div class="rl-code-locked-row">
         <div class="rl-code-locked-display"><span class="lock-icon">🔒</span>${escapeHtml(entry.code)}</div>
         <button class="action secondary rl-mini-btn" data-entryid="${entry.entryId}" data-action="copyCode" type="button">Copy</button>
         <button class="action secondary rl-mini-btn" data-entryid="${entry.entryId}" data-action="requestUnlock" type="button">Unlock</button>
       </div>`
    : `<div class="rl-code-row">
         <input type="text" class="rl-code-input" placeholder="Gift card code" value="${escapeHtml(entry.code || '')}" data-entryid="${entry.entryId}" data-field="code">
         <button class="action secondary rl-mini-btn" data-entryid="${entry.entryId}" data-action="copyCode" type="button">Copy</button>
       </div>`;

  const expandedBody = isOpen ? `
    <div class="rl-expanded-body">
      <div class="rl-meta">${escapeHtml(entry.server || '—')} · ${entry.targetLabel || (entry.target + (entry.currency || ''))}</div>
      ${codeRow}
      <div class="rl-proof-row">
        <label class="action secondary rl-mini-btn" for="proof-${entry.entryId}" style="cursor:pointer;">Upload Proof</label>
        <input type="file" id="proof-${entry.entryId}" accept="image/*,.pdf" style="display:none;" data-entryid="${entry.entryId}" data-action="uploadProof">
        ${entry.proof ? `<button class="action secondary rl-mini-btn" data-entryid="${entry.entryId}" data-action="downloadProof" type="button">Download Proof</button>` : ''}
        ${entry.proof && entry.proof.startsWith('data:image') ? `<img class="rl-thumb" src="${entry.proof}">` : ''}
      </div>
      <div class="rl-sold-row">
        ${entry.sold
          ? `<span class="rl-sold-badge">Sold ${fmtDate(new Date(entry.soldDate + "T00:00:00"))} · ₹${entry.soldPrice || 0}</span>
             <button type="button" class="rl-unmark-btn" data-entryid="${entry.entryId}" data-action="requestUnmark">Mark as Unsold</button>`
          : `<input type="number" class="rl-price-input" id="soldPrice-${entry.entryId}" placeholder="₹ Price" value="${entry.soldPrice || ''}">
             <button type="button" class="rl-mark-sold-btn" data-entryid="${entry.entryId}"><span class="rl-fill"></span><span>Hold to Mark Sold</span></button>`
        }
      </div>
      <button type="button" class="rl-delete-btn" data-entryid="${entry.entryId}" data-action="requestDelete">Delete This Record</button>
    </div>
  ` : '';

  return `
    <div class="redeem-log-entry">
      <div class="rl-collapsed-row" data-entryid="${entry.entryId}" data-action="toggleExpand">
        <div class="rl-collapsed-left">
          <div class="rl-name">${entry.id}) ${escapeHtml(entry.name)}</div>
          <div class="rl-meta">${fmtEntryDateTime(entry)} · ${entry.points} pts</div>
        </div>
        <div class="rl-collapsed-right">
          ${entry.code ? '<span class="rl-icon" title="Code saved">🔑</span>' : ''}
          ${entry.proof ? '<span class="rl-icon" title="Proof attached">📎</span>' : ''}
          <span class="rl-status-badge ${entry.sold ? 'sold' : 'unsold'}">${entry.sold ? 'Sold' : 'Unsold'}</span>
          <span class="rl-expand-arrow">${isOpen ? '▴' : '▾'}</span>
        </div>
      </div>
      ${expandedBody}
    </div>
  `;
}

const LOW_STOCK_THRESHOLD = 3;
const TARGET_LABELS = { "5": "5€/$", "10": "10€/$", "lol": "575 RP", "ow": "OW 1000" };

function renderRedeemLogOverview(){
  const box = document.getElementById("rlOverview");
  if(!box) return;
  const available = redeemLog.filter(e => !e.sold);
  const counts = { "5": 0, "10": 0, "lol": 0, "ow": 0 };
  available.forEach(e => { if(counts.hasOwnProperty(e.target)) counts[e.target]++; });
  if(available.length === 0){
    box.innerHTML = "No codes available to sell right now.";
    return;
  }
  const low = Object.keys(counts).filter(k => counts[k] > 0 && counts[k] <= LOW_STOCK_THRESHOLD);
  const lowLine = low.length > 0
    ? `<div class="rl-low-stock">⚠ Running low: ${low.map(k => `${TARGET_LABELS[k]} (${counts[k]} left)`).join(" · ")}</div>`
    : "";
  box.innerHTML = `<strong>${available.length} available to sell</strong> — ` +
    `5€/$: ${counts["5"]} · 10€/$: ${counts["10"]} · 575 RP: ${counts["lol"]} · OW 1000: ${counts["ow"]}${lowLine}`;
}

function renderRedeemLog(){
  populateRlMonthFilter();
  populateRlServerFilter();
  renderRedeemLogOverview();

  const container = document.getElementById("redeemLogList");
  let list = [...redeemLog];

  if(rlSearchTerm){
    const q = rlSearchTerm.toLowerCase();
    list = list.filter(e =>
      (e.name || "").toLowerCase().includes(q) ||
      String(e.id).includes(q) ||
      (e.server || "").toLowerCase().includes(q)
    );
  }
  if(rlSoldFilter === "unsold") list = list.filter(e => !e.sold);
  if(rlSoldFilter === "sold") list = list.filter(e => e.sold);
  if(rlTargetFilter !== "all") list = list.filter(e => e.target === rlTargetFilter);
  if(rlMonthFilter !== "all") list = list.filter(e => e.date.slice(0,7) === rlMonthFilter);
  if(rlServerFilter !== "all") list = list.filter(e => (e.server || "").trim() === rlServerFilter);
  if(rlMissingFilter === "proof") list = list.filter(e => !e.proof);
  if(rlMissingFilter === "code") list = list.filter(e => !e.code);

  const matured = list.filter(e => e.sold && e.soldDate && daysSince(e.soldDate) >= 7);
  const recent = list.filter(e => !(e.sold && e.soldDate && daysSince(e.soldDate) >= 7));

  container.innerHTML = recent.length === 0
    ? '<div class="redeem-log-empty">No matching redemptions.</div>'
    : sortEntries(recent).map(renderEntryCard).join("");

  const soldSection = document.getElementById("rlSoldSection");
  const soldLabel = document.getElementById("rlSoldToggleLabel");
  const soldArrow = document.getElementById("rlSoldToggleArrow");
  const soldBody = document.getElementById("rlSoldSectionBody");
  if(matured.length === 0){
    soldSection.classList.add("hidden");
  }else{
    soldSection.classList.remove("hidden");
    soldLabel.textContent = `Sold 7+ days ago (${matured.length})`;
    soldArrow.textContent = rlSoldSectionExpanded ? "▴" : "▾";
    soldBody.classList.toggle("hidden", !rlSoldSectionExpanded);
    soldBody.innerHTML = sortEntries(matured).map(renderEntryCard).join("");
  }
}

async function fileToDataUrl(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function fileToCompressedDataUrl(file){
  // PDFs can't be canvas-compressed — pass through as-is (rare/small enough usually)
  if(file.type === "application/pdf"){
    return fileToDataUrl(file);
  }
  const rawDataUrl = await fileToDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX_DIM = 1000;
      let { width, height } = img;
      if(width > MAX_DIM || height > MAX_DIM){
        if(width > height){ height = Math.round(height * (MAX_DIM / width)); width = MAX_DIM; }
        else{ width = Math.round(width * (MAX_DIM / height)); height = MAX_DIM; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.65));
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

function copyText(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text){
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try{ document.execCommand("copy"); }catch(e){}
  document.body.removeChild(ta);
}

let codeSaveTimeout = null;
document.getElementById("redeemLogPanel").addEventListener("input", (e) => {
  const entryId = e.target.dataset.entryid;
  const field = e.target.dataset.field;
  if(!entryId || field !== "code") return;
  const entry = redeemLog.find(x => x.entryId === entryId);
  if(!entry) return;
  entry.code = e.target.value;
  clearTimeout(codeSaveTimeout);
  codeSaveTimeout = setTimeout(() => { saveRedeemLog(); }, 600);
});

document.getElementById("redeemLogPanel").addEventListener("blur", (e) => {
  if(e.target && e.target.dataset && e.target.dataset.field === "code"){
    clearTimeout(codeSaveTimeout);
    const entryId = e.target.dataset.entryid;
    const entry = redeemLog.find(x => x.entryId === entryId);
    if(entry && entry.code && entry.code.trim()){
      const normalized = entry.code.trim().toLowerCase();
      const duplicate = redeemLog.find(x => x.entryId !== entryId && (x.code || "").trim().toLowerCase() === normalized);
      if(duplicate){
        alert(`Heads up: this code is already saved on entry ${duplicate.id}) ${duplicate.name} (${fmtDate(new Date(duplicate.date + "T00:00:00"))}). Double-check it wasn't pasted by mistake.`);
      }
      entry.codeLocked = true;
      saveRedeemLog();
      renderRedeemLog();
    }else{
      saveRedeemLog();
    }
  }
}, true);

document.getElementById("redeemLogPanel").addEventListener("change", async (e) => {
  const entryId = e.target.dataset.entryid;
  const action = e.target.dataset.action;
  if(action === "uploadProof" && entryId){
    const file = e.target.files[0];
    if(!file) return;
    const entry = redeemLog.find(x => x.entryId === entryId);
    if(!entry) return;
    try{
      showToast("Uploading proof...");
      const compressed = await fileToCompressedDataUrl(file);
      entry.proof = compressed;
      await fbSaveProof(entryId, compressed);
      await saveRedeemLog();
      renderRedeemLog();
      showToast("Proof saved and synced.");
    }catch(err){
      console.error(err);
      alert("Could not read or sync that file.");
    }
  }
});

document.getElementById("redeemLogPanel").addEventListener("click", (e) => {
  const el = e.target.closest("[data-action][data-entryid]");
  if(!el) return;
  const entryId = el.dataset.entryid;
  const action = el.dataset.action;
  const entry = redeemLog.find(x => x.entryId === entryId);
  if(!entry) return;

  if(action === "toggleExpand"){
    if(rlExpanded.has(entryId)) rlExpanded.delete(entryId); else rlExpanded.add(entryId);
    renderRedeemLog();
    return;
  }
  if(action === "copyCode"){
    copyText(entry.code || "");
    const original = el.textContent;
    el.textContent = "Copied!";
    setTimeout(() => { el.textContent = original; }, 1200);
  }
  if(action === "downloadProof" && entry.proof){
    const a = document.createElement("a");
    a.href = entry.proof;
    const ext = entry.proof.startsWith("data:image/png") ? "png" : entry.proof.startsWith("data:application/pdf") ? "pdf" : "jpg";
    a.download = `proof-${entry.id}-${entry.date}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  if(action === "requestUnlock"){
    confirmPendingEntryId = entryId;
    confirmPendingAction = "unlockCode";
    document.getElementById("unlockModalTitle").textContent = "Unlock this code for editing?";
    document.getElementById("unlockModalSub").textContent = "It will lock itself again once you tap away.";
    document.getElementById("unlockConfirmBtn").textContent = "Unlock";
    document.getElementById("unlockConfirmBtn").disabled = false;
    document.getElementById("unlockModal").classList.remove("hidden");
  }
  if(action === "requestUnmark"){
    confirmPendingEntryId = entryId;
    confirmPendingAction = "unmarkSold";
    document.getElementById("unlockModalTitle").textContent = "Mark this as unsold again?";
    document.getElementById("unlockModalSub").textContent = `This removes ₹${entry.soldPrice || 0} from your earnings totals.`;
    document.getElementById("unlockConfirmBtn").textContent = "Confirm";
    document.getElementById("unlockConfirmBtn").disabled = false;
    document.getElementById("unlockModal").classList.remove("hidden");
  }
  if(action === "requestDelete"){
    confirmPendingEntryId = entryId;
    confirmPendingAction = "deleteEntry";
    document.getElementById("unlockModalTitle").textContent = "Delete this record permanently?";
    document.getElementById("unlockModalSub").textContent = "This removes the code, proof, and sold history for this redemption. This can't be undone.";
    document.getElementById("unlockConfirmBtn").textContent = "Delete";
    document.getElementById("unlockConfirmBtn").disabled = false;
    document.getElementById("unlockModal").classList.remove("hidden");
  }
});

// Hold-to-confirm mark/unmark sold (3 seconds, both directions)
function startSoldHold(btn){
  cancelSoldHold();
  const fill = btn.querySelector(".rl-fill");
  if(!fill) return;
  fill.style.transition = "none";
  fill.style.width = "0%";
  void fill.offsetWidth;
  fill.style.transition = "width 3000ms linear";
  fill.style.width = "100%";
  holdBtnEl = btn;
  const entryId = btn.dataset.entryid;
  holdTimeout = setTimeout(() => {
    holdTimeout = null;
    holdBtnEl = null;
    const entry = redeemLog.find(x => x.entryId === entryId);
    if(!entry) return;
    if(!entry.sold){
      const priceInput = document.getElementById("soldPrice-" + entryId);
      const price = priceInput ? Number(priceInput.value) || 0 : 0;
      entry.soldPrice = price;
      entry.sold = true;
      entry.soldDate = todayStr();
    }else{
      entry.sold = false;
      entry.soldDate = null;
    }
    saveRedeemLog();
    renderRedeemLog();
    renderStats();
  }, 3000);
}
function cancelSoldHold(){
  if(holdTimeout){ clearTimeout(holdTimeout); holdTimeout = null; }
  if(holdBtnEl){
    const fill = holdBtnEl.querySelector(".rl-fill");
    if(fill){
      fill.style.transition = "width 150ms ease-out";
      fill.style.width = "0%";
    }
    holdBtnEl = null;
  }
}
document.getElementById("redeemLogPanel").addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".rl-mark-sold-btn");
  if(!btn) return;
  startSoldHold(btn);
});
document.addEventListener("pointerup", cancelSoldHold);
document.addEventListener("pointercancel", cancelSoldHold);
document.getElementById("redeemLogPanel").addEventListener("contextmenu", (e) => {
  if(e.target.closest(".rl-mark-sold-btn")) e.preventDefault();
});

// Redeem log filter wiring
document.getElementById("rlSearch").addEventListener("input", (e) => {
  rlSearchTerm = e.target.value;
  renderRedeemLog();
});
document.querySelectorAll(".chip[data-rlsold]").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip[data-rlsold]").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    rlSoldFilter = chip.dataset.rlsold;
    renderRedeemLog();
  });
});
document.querySelectorAll(".chip[data-rltarget]").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip[data-rltarget]").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    rlTargetFilter = chip.dataset.rltarget;
    renderRedeemLog();
  });
});
document.getElementById("rlMonthFilter").addEventListener("change", (e) => {
  rlMonthFilter = e.target.value;
  renderRedeemLog();
});
document.getElementById("rlServerFilter").addEventListener("change", (e) => {
  rlServerFilter = e.target.value;
  renderRedeemLog();
});
document.querySelectorAll(".chip[data-rlmissing]").forEach(chip => {
  chip.addEventListener("click", () => {
    const val = chip.dataset.rlmissing;
    if(rlMissingFilter === val){
      rlMissingFilter = null;
      chip.classList.remove("active");
    }else{
      rlMissingFilter = val;
      document.querySelectorAll(".chip[data-rlmissing]").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
    }
    renderRedeemLog();
  });
});

document.querySelectorAll(".chip[data-rlsort]").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip[data-rlsort]").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    rlSortMode = chip.dataset.rlsort;
    renderRedeemLog();
  });
});

document.getElementById("rlSoldSectionToggle").addEventListener("click", () => {
  rlSoldSectionExpanded = !rlSoldSectionExpanded;
  renderRedeemLog();
});

document.getElementById("unlockCancelBtn").addEventListener("click", () => {
  clearInterval(confirmCountdownInterval);
  confirmCountdownInterval = null;
  confirmPendingEntryId = null;
  confirmPendingAction = null;
  document.getElementById("unlockModal").classList.add("hidden");
});

document.getElementById("unlockConfirmBtn").addEventListener("click", (e) => {
  if(!confirmPendingEntryId || !confirmPendingAction) return;
  let remaining = 3;
  const btn = e.target;
  const sub = document.getElementById("unlockModalSub");
  const verb = confirmPendingAction === "unlockCode" ? "Unlocking" : confirmPendingAction === "deleteEntry" ? "Deleting" : "Updating";
  btn.disabled = true;
  btn.textContent = `${verb} in ${remaining}...`;
  sub.textContent = "Hang on a moment.";
  clearInterval(confirmCountdownInterval);
  confirmCountdownInterval = setInterval(() => {
    remaining--;
    if(remaining <= 0){
      clearInterval(confirmCountdownInterval);
      confirmCountdownInterval = null;
      if(confirmPendingAction === "deleteEntry"){
        redeemLog = redeemLog.filter(x => x.entryId !== confirmPendingEntryId);
        fbDeleteProof(confirmPendingEntryId);
      }else{
        const entry = redeemLog.find(x => x.entryId === confirmPendingEntryId);
        if(entry){
          if(confirmPendingAction === "unlockCode"){
            entry.codeLocked = false;
          }else if(confirmPendingAction === "unmarkSold"){
            entry.sold = false;
            entry.soldDate = null;
          }
        }
      }
      confirmPendingEntryId = null;
      confirmPendingAction = null;
      saveRedeemLog();
      document.getElementById("unlockModal").classList.add("hidden");
      renderRedeemLog();
      renderStats();
    }else{
      btn.textContent = `${verb} in ${remaining}...`;
    }
  }, 1000);
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  if(!confirm("Reset all 66 accounts to zero? This clears points, targets and bonuses.")) return;
  rows = defaultRows();
  await saveRows();
  render();
});

function downloadBlob(content, filename, type){
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById("exportJsonBtn").addEventListener("click", () => {
  const payload = JSON.stringify({ dailyPoints, rows, redeemLog }, null, 2);
  downloadBlob(payload, "points-tracker-" + todayStr() + ".json", "application/json");
});

document.getElementById("exportCsvBtn").addEventListener("click", () => {
  const header = ["ID","Name","Server","StartPoints","StartDate","DailyRate","Target","ExtraArrived","ExtraScheduled","TodayPoints","Remaining","DaysLeft","CompletionDate","Redeemed","RedeemedDate"];
  const lines = [header.join(",")];
  rows.forEach(r => {
    const calc = computeRow(r);
    const events = Array.isArray(r.extraEvents) ? r.extraEvents : [];
    const scheduled = events
      .filter(ev => ev.date > todayStr())
      .map(ev => ev.date + ":+" + ev.points)
      .join(" | ");
    lines.push([
      r.id,
      '"' + (r.name||"").replace(/"/g,'""') + '"',
      '"' + (r.server||"").replace(/"/g,'""') + '"',
      r.startPoints,
      r.startDate,
      r.dailyRate || "",
      targetLabel(r),
      calc.extraSoFar || 0,
      '"' + scheduled.replace(/"/g,'""') + '"',
      calc.effective,
      calc.remaining,
      calc.daysNeeded,
      calc.remaining === 0 ? "Completed" : fmtDate(calc.completion),
      r.redeemed ? "Yes" : "No",
      r.redeemedDate || ""
    ].join(","));
  });
  downloadBlob(lines.join("\n"), "points-tracker-" + todayStr() + ".csv", "text/csv");
});

document.getElementById("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try{
      const parsed = JSON.parse(reader.result);
      if(parsed.rows){
        rows = parsed.rows;
        if(parsed.dailyPoints) dailyPoints = parsed.dailyPoints;
        if(parsed.redeemLog) redeemLog = parsed.redeemLog;
        ensureFullRoster();
        normalizeRows();
        await saveRows();
        await saveSettings();
        await saveRedeemLog();
        for(const entry of redeemLog){
          if(entry.proof){
            try{ await fbSaveProof(entry.entryId, entry.proof); }catch(err){ console.error(err); }
          }
        }
        document.getElementById("dailyPoints").value = dailyPoints;
        render();
        alert("Import successful.");
      }else{
        alert("This file doesn't look like a valid backup.");
      }
    }catch(err){
      alert("Couldn't read that file. Make sure it's a JSON export from this tool.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

const SYNC_CODE_LS_KEY = "pts-sync-code";

function showSyncGate(){
  document.getElementById("syncGate").classList.remove("hidden");
}
function hideSyncGate(){
  document.getElementById("syncGate").classList.add("hidden");
}

async function connectWithCode(code){
  if(!fbReady){
    document.getElementById("syncGateStatus").textContent = "Sync service isn't ready yet — wait a moment and try again.";
    return;
  }
  const trimmed = code.trim();
  if(!trimmed){
    document.getElementById("syncGateStatus").textContent = "Enter your sync code first.";
    return;
  }
  document.getElementById("syncGateStatus").textContent = "Connecting...";
  syncCode = trimmed;
  try{
    await loadData();
    localStorage.setItem(SYNC_CODE_LS_KEY, trimmed);
    hideSyncGate();
  }catch(e){
    console.error(e);
    document.getElementById("syncGateStatus").textContent = "Couldn't connect — check your internet connection and try again.";
  }
}

document.getElementById("syncCodeSubmit").addEventListener("click", () => {
  connectWithCode(document.getElementById("syncCodeInput").value);
});
document.getElementById("syncCodeInput").addEventListener("keydown", (e) => {
  if(e.key === "Enter") connectWithCode(document.getElementById("syncCodeInput").value);
});
document.getElementById("changeSyncCodeBtn").addEventListener("click", () => {
  localStorage.removeItem(SYNC_CODE_LS_KEY);
  document.getElementById("syncCodeInput").value = "";
  document.getElementById("syncGateStatus").textContent = "";
  showSyncGate();
});

(async () => {
  const submitBtn = document.getElementById("syncCodeSubmit");
  const statusEl = document.getElementById("syncGateStatus");
  submitBtn.disabled = true;
  statusEl.textContent = "Loading sync service...";

  const ready = await initFirebase();
  if(!ready) return; // initFirebase already displayed the error message

  submitBtn.disabled = false;
  statusEl.textContent = "";

  const savedCode = localStorage.getItem(SYNC_CODE_LS_KEY);
  if(savedCode){
    syncCode = savedCode;
    statusEl.textContent = "Connecting...";
    try{
      await loadData();
      hideSyncGate();
    }catch(e){
      console.error(e);
      statusEl.textContent = "Couldn't connect — check your internet connection.";
      showSyncGate();
    }
  }else{
    showSyncGate();
  }
})();

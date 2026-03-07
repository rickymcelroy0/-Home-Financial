const firebaseConfig = {
  databaseURL: 'https://homefund-3b81a-default-rtdb.firebaseio.com/',
  projectId: 'homefund-3b81a',
  authDomain: 'homefund-3b81a.firebaseapp.com',
  storageBucket: 'homefund-3b81a.appspot.com'
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const SESSION_KEY = 'hfc_session_v3';
const params = new URLSearchParams(window.location.search);
const kind = params.get('kind') || 'checking';
const userId = params.get('user') || 'admin';
const sessionUser = localStorage.getItem(SESSION_KEY) || 'admin';

let users = {}, balances = {}, bills = {}, privateBills = {}, ledger = {}, system = { treasury: { reserve: 0 } };

const money = (n) => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(Number(n || 0));
const number = (n) => Number(Number(n || 0).toFixed(2));
const sortNewest = (arr) => [...arr].sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
const isAdmin = () => users[sessionUser]?.role === 'admin';

// Protect private ledger items from the admin
const ledgerItemsForUser = (uid) => sortNewest(Object.values(ledger).filter((x) => x.userId === uid && (!isAdmin() || !x.isPrivate)));
const publicLedger = () => Object.values(ledger).filter(x => x.type !== 'private_bill_created' && x.type !== 'private_bill_paid');

// Filter out private bills if an admin is looking
const visibleBills = () => Object.entries(bills).filter(([_, b]) => !isAdmin() || !b.isPrivate);
const openBillsForUser = (uid) => visibleBills().filter(([_, b]) => b.userId === uid && b.status === 'open');
const paidBillsForUser = (uid) => visibleBills().filter(([_, b]) => b.userId === uid && b.status === 'paid');

const openPrivateBillsForUser = (uid) => Object.entries(privateBills[uid] || {}).filter(([_,b]) => b.status === 'open');
const paidPrivateBillsForUser = (uid) => Object.entries(privateBills[uid] || {}).filter(([_,b]) => b.status === 'paid');

function renderSummary(cards){
  document.getElementById('summary-row').innerHTML = cards.map((card) => `
  <div class="col-md-4">
  <div class="glass p-4 h-100">
  <div class="label">${card.label}</div>
  <h3 class="mt-2 mb-0">${card.value}</h3>
  </div>
  </div>`).join('');
}
function renderLedger(items){
  const pane = document.getElementById('ledger-pane');
  if (!items.length) { pane.innerHTML = '<div class="text-muted">No activity yet.</div>'; return; }
  pane.innerHTML = items.slice(0,20).map((item) => `
  <div class="list-row">
  <div>
  <div class="fw-semibold">${item.title || 'Activity'} ${item.isPrivate ? '<span class="private-badge ms-2"><i class="fa-solid fa-lock"></i></span>' : ''}</div>
  <div class="text-muted small">${item.description || ''}</div>
  </div>
  <div class="text-end">
  <div class="fw-semibold">${item.amount != null ? money(item.amount) : ''}</div>
  <div class="text-muted small">${new Date(item.createdAt || Date.now()).toLocaleString()}</div>
  </div>
  </div>`).join('');
}
function renderTable(headers, rows){
  return `<div class="table-responsive"><table class="table align-middle mb-0"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="text-muted">No records.</td></tr>`}</tbody></table></div>`;
}

async function debitBillVault(uid, amount){
  const result = await db.ref(`balances/${uid}/staging`).transaction((cur) => {
    cur = number(cur);
    if (cur < amount) return;
    return number(cur - amount);
  });
  return result.committed;
}
async function writeLedger(entry){ return db.ref('ledger').push({ createdAt: new Date().toISOString(), ...entry }); }

async function payBill(billId){
  const bill = bills[billId];
  if (!bill || bill.status !== 'open') return alert('Bill is not open.');
  if (!isAdmin() && sessionUser !== bill.userId) return alert('You cannot pay this bill.');
  const amount = number(bill.amount);
  if (!await debitBillVault(bill.userId, amount)) return alert('Not enough money in the bill vault.');
  await db.ref(`bills/${billId}`).update({ status:'paid', paidAt:new Date().toISOString(), paidBy: sessionUser });
  await writeLedger({ type:'bill_paid', userId: bill.userId, amount, title:'Shared bill paid', description:`${bill.name} paid from bill vault by ${users[sessionUser]?.name || sessionUser}.` });
}
window.payBill = payBill;

async function payPrivateBill(billId){
  if (sessionUser !== userId) return alert('Only the account owner can pay this private bill.');
  const bill = (privateBills[userId] || {})[billId];
  if (!bill || bill.status !== 'open') return alert('Private bill is not open.');
  const amount = number(bill.amount);
  if (!await debitBillVault(userId, amount)) return alert('Not enough money in the bill vault.');
  await db.ref(`privateBills/${userId}/${billId}`).update({ status:'paid', paidAt:new Date().toISOString() });
  await writeLedger({ type:'private_bill_paid', userId, amount, title:'Private bill paid', description:`${bill.name} paid from the bill vault.`, isPrivate: true });
}
window.payPrivateBill = payPrivateBill;

function render(){
  const user = users[userId] || { name:userId, role:'unknown', accountNumber:'—', status:'unknown' };
  const userBals = balances[userId] || { personal:0, staging:0 };
  const detail = document.getElementById('detail-pane');
  const subtitle = document.getElementById('window-subtitle');
  const actionBtn = document.getElementById('action-btn');
  actionBtn.classList.add('d-none');

  if (kind === 'checking'){
    document.getElementById('window-title').textContent = `${user.name} · Checking`;
    subtitle.textContent = `Account ${user.accountNumber || '—'}`;
    renderSummary([
      { label:'Checking Balance', value: money(userBals.personal) },
                  { label:'Shared Bills Due', value: money(openBillsForUser(userId).reduce((s,[_,b]) => s + number(b.amount), 0)) },
                  { label:'Private Bills Due', value: money(openPrivateBillsForUser(userId).reduce((s,[_,b]) => s + number(b.amount), 0)) }
    ]);
    detail.innerHTML = `<div class="mb-3 text-muted">Checking holds available funds before you move them into the bill vault.</div>` + renderTable(['Type','Description','Amount','When'], ledgerItemsForUser(userId).filter((x) => ['client_created','treasury_transfer','transfer'].includes(x.type)).slice(0,15).map((item) => `<tr><td>${item.title || item.type} ${item.isPrivate ? '<span class="private-badge ms-2"><i class="fa-solid fa-lock"></i></span>' : ''}</td><td>${item.description || ''}</td><td>${item.amount != null ? money(item.amount) : ''}</td><td>${new Date(item.createdAt || Date.now()).toLocaleString()}</td></tr>`));
    renderLedger(ledgerItemsForUser(userId));
    return;
  }

  if (kind === 'staging'){
    document.getElementById('window-title').textContent = `${user.name} · Bill Vault`;
    subtitle.textContent = 'Reserved funds for shared bills';

    const sharedDue = openBillsForUser(userId).reduce((s,[_,b]) => s + number(b.amount), 0);

    renderSummary([
      { label:'Bill Vault', value: money(userBals.staging) },
                  { label:'Shared Due', value: money(sharedDue) },
                  { label:'Coverage Delta', value: money(number(userBals.staging) - sharedDue) }
    ]);

    detail.innerHTML = `<div class="mb-3 text-muted">The bill vault is the internal account used to pay bills and track bill readiness automatically.</div>` + renderTable(['Bill','Due Date','Amount','Status'], openBillsForUser(userId).map(([_,b]) => `<tr><td>${b.name}</td><td>${b.dueDate || '—'}</td><td>${money(b.amount)}</td><td>${b.status}</td></tr>`));
    renderLedger(ledgerItemsForUser(userId).filter((x) => ['transfer','bill_paid','treasury_transfer'].includes(x.type) && !x.isPrivate));
    return;
  }

  if (kind === 'private_bills' || kind === 'private_vault'){
    document.getElementById('window-title').textContent = `${user.name} · Private Bills`;
    subtitle.textContent = 'Personal planner bills only shown to the account owner in-app';
    renderSummary([
      { label:'Open Private Bills', value: String(openPrivateBillsForUser(userId).length) },
                  { label:'Open Total', value: money(openPrivateBillsForUser(userId).reduce((s,[_,b]) => s + number(b.amount), 0)) },
                  { label:'Paid Private Bills', value: String(paidPrivateBillsForUser(userId).length) }
    ]);
    detail.innerHTML = renderTable(['Bill','Category','Due','Amount','Status','Action'], sortNewest(Object.entries(privateBills[userId] || {})).map(([billId,b]) => `<tr><td>${b.name} <span class="private-badge ms-2"><i class="fa-solid fa-lock"></i> Private</span></td><td>${b.category || 'Personal'}</td><td>${b.dueDate || '—'}</td><td>${money(b.amount)}</td><td>${b.status}</td><td>${b.status === 'open' && sessionUser === userId ? `<button class="btn btn-sm btn-success" onclick="payPrivateBill('${billId}')">Pay</button>` : ''}</td></tr>`));
    renderLedger(ledgerItemsForUser(userId).filter((x) => ['private_bill_created','private_bill_paid'].includes(x.type)));
    return;
  }

  if (kind === 'bills'){
    document.getElementById('window-title').textContent = `${user.name} · Shared Bills`;
    subtitle.textContent = 'Treasury-visible bill queue';
    renderSummary([
      { label:'Open Shared Bills', value: String(openBillsForUser(userId).length) },
                  { label:'Open Total', value: money(openBillsForUser(userId).reduce((s,[_,b]) => s + number(b.amount), 0)) },
                  { label:'Paid Shared Bills', value: String(paidBillsForUser(userId).length) }
    ]);
    detail.innerHTML = renderTable(['Bill','Due','Amount','Status','Action'], sortNewest(visibleBills().filter(([_,b]) => b.userId === userId)).map(([billId,b]) => `<tr><td>${b.name}</td><td>${b.dueDate || '—'}</td><td>${money(b.amount)}</td><td>${b.status}</td><td>${b.status === 'open' && (isAdmin() || sessionUser === userId) ? `<button class="btn btn-sm btn-primary" onclick="payBill('${billId}')">Pay</button>` : ''}</td></tr>`));
    renderLedger(ledgerItemsForUser(userId).filter((x) => ['bill_created','bill_paid'].includes(x.type) && !x.isPrivate));
    return;
  }

  if (kind === 'client_overview'){
    document.getElementById('window-title').textContent = `${user.name} · Client Overview`;
    subtitle.textContent = `${user.accountNumber || '—'} · ${user.status}`;
    renderSummary([
      { label:'Checking', value: money(userBals.personal) },
                  { label:'Bill Vault', value: money(userBals.staging) },
                  { label:'Shared Bills Due', value: money(openBillsForUser(userId).reduce((s,[_,b]) => s + number(b.amount), 0)) }
    ]);
    detail.innerHTML = `<div class="row g-3 mb-3"><div class="col-md-6"><div class="mini"><div class="label">Profile</div><div class="mt-2"><strong>${user.name}</strong><div class="text-muted">${userId}</div><div class="text-muted">${user.accountNumber || '—'}</div><div class="text-muted">Status: ${user.status}</div></div></div></div><div class="col-md-6"><div class="mini"><div class="label">Planner note</div><div class="mt-2 text-muted">Private bill details are intentionally not surfaced in admin overview windows.</div></div></div></div>` + renderTable(['Bill','Amount','Status'], sortNewest(visibleBills().filter(([_,b]) => b.userId === userId)).slice(0,10).map(([_,b]) => `<tr><td>${b.name}</td><td>${money(b.amount)}</td><td>${b.status}</td></tr>`));
    renderLedger(ledgerItemsForUser(userId));
    return;
  }

  if (kind === 'admin_treasury'){
    document.getElementById('window-title').textContent = 'Administrator · Treasury';
    subtitle.textContent = 'Master source account and shared bill center';
    renderSummary([
      { label:'Treasury Reserve', value: money(system?.treasury?.reserve) },
                  { label:'Open Shared Bills', value: String(Object.values(bills).filter((b) => b.status === 'open').length) },
                  { label:'Open Shared Total', value: money(Object.values(bills).filter((b) => b.status === 'open').reduce((s,b) => s + number(b.amount), 0)) }
    ]);
    detail.innerHTML = renderTable(['Client','Bill','Due','Amount','Status'], sortNewest(Object.entries(bills)).map(([_,b]) => `<tr><td>${users[b.userId]?.name || b.userId}</td><td>${b.name}</td><td>${b.dueDate || '—'}</td><td>${money(b.amount)}</td><td>${b.status}</td></tr>`));
    renderLedger(sortNewest(publicLedger()).filter((x) => ['treasury_funded','treasury_transfer','bill_created','bill_paid'].includes(x.type)));
    return;
  }

  if (kind === 'admin_global_cash'){
    document.getElementById('window-title').textContent = 'Administrator · User Checking';
    subtitle.textContent = 'Every user checking account';
    renderSummary([
      { label:'Total Checking', value: money(Object.entries(balances).filter(([uid]) => uid !== 'admin').reduce((s,[_,b]) => s + number(b.personal), 0)) },
                  { label:'Accounts', value: String(Object.keys(users).length) },
                  { label:'Clients', value: String(Object.values(users).filter((u) => u.role === 'client').length) }
    ]);
    detail.innerHTML = renderTable(['User','Account Number','Checking'], Object.entries(users).filter(([_,u]) => u.role === 'client').map(([uid,u]) => `<tr><td>${u.name}</td><td>${u.accountNumber || '—'}</td><td>${money(balances[uid]?.personal || 0)}</td></tr>`));
    renderLedger(sortNewest(publicLedger()).filter((x) => ['treasury_transfer','transfer'].includes(x.type)));
    return;
  }

  if (kind === 'admin_global_staging'){
    document.getElementById('window-title').textContent = 'Administrator · Bill Vault Balances';
    subtitle.textContent = 'Every reserved bill balance';
    renderSummary([
      { label:'Total Bill Vault', value: money(Object.entries(balances).filter(([uid]) => uid !== 'admin').reduce((s,[_,b]) => s + number(b.staging), 0)) },
                  { label:'Open Shared Bills', value: String(Object.values(bills).filter((b) => b.status === 'open').length) },
                  { label:'Paid Shared Bills', value: String(Object.values(bills).filter((b) => b.status === 'paid').length) }
    ]);
    detail.innerHTML = renderTable(['User','Bill Vault','Shared Bill Total'], Object.entries(users).filter(([_,u]) => u.role === 'client').map(([uid,u]) => `<tr><td>${u.name}</td><td>${money(balances[uid]?.staging || 0)}</td><td>${money(openBillsForUser(uid).reduce((s,[_,b]) => s + number(b.amount), 0))}</td></tr>`));
    renderLedger(sortNewest(publicLedger()).filter((x) => ['treasury_transfer','bill_paid','transfer'].includes(x.type)));
    return;
  }

  if (kind === 'admin_open_bills'){
    document.getElementById('window-title').textContent = 'Administrator · Shared Bills';
    subtitle.textContent = 'System-wide shared bill queue';
    renderSummary([
      { label:'Open Shared Total', value: money(Object.values(bills).filter((b) => b.status === 'open').reduce((s,b) => s + number(b.amount), 0)) },
                  { label:'Open Shared Bills', value: String(Object.values(bills).filter((b) => b.status === 'open').length) },
                  { label:'Paid Shared Bills', value: String(Object.values(bills).filter((b) => b.status === 'paid').length) }
    ]);
    detail.innerHTML = renderTable(['Client','Bill','Due','Amount','Status','Action'], sortNewest(Object.entries(bills)).map(([billId,b]) => `<tr><td>${users[b.userId]?.name || b.userId}</td><td>${b.name}</td><td>${b.dueDate || '—'}</td><td>${money(b.amount)}</td><td>${b.status}</td><td>${b.status === 'open' ? `<button class="btn btn-sm btn-primary" onclick="payBill('${billId}')">Pay</button>` : ''}</td></tr>`));
    renderLedger(sortNewest(publicLedger()).filter((x) => ['bill_created','bill_paid'].includes(x.type)));
    return;
  }
}

db.ref('users').on('value', (snap) => { users = snap.val() || {}; render(); });
db.ref('balances').on('value', (snap) => { balances = snap.val() || {}; render(); });
db.ref('bills').on('value', (snap) => { bills = snap.val() || {}; render(); });
db.ref('privateBills').on('value', (snap) => { privateBills = snap.val() || {}; render(); });
db.ref('ledger').on('value', (snap) => { ledger = snap.val() || {}; render(); });
db.ref('system').on('value', (snap) => { system = snap.val() || { treasury: { reserve: 0 } }; render(); });

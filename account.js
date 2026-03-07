const firebaseConfig = {
  databaseURL: 'https://homefund-3b81a-default-rtdb.firebaseio.com/',
  projectId: 'homefund-3b81a',
  authDomain: 'homefund-3b81a.firebaseapp.com',
  storageBucket: 'homefund-3b81a.appspot.com'
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const params = new URLSearchParams(window.location.search);
const kind = params.get('kind') || 'checking';
const userId = params.get('user') || 'admin';

// FIXED: Now tracks all 8 top-level nodes
const state = {
  users: {},
  balances: {},
  bills: {},
  ledger: {},
  loans: {},
  logs: {},
  masterBankLedger: {},
  system: {}
};

function money(n){ return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(Number(n || 0)); }
function escapeHtml(value){ return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
function getUser(id){ return state.users[id] || { name:id, role:id === 'admin' ? 'admin' : 'client', status:'active' }; }
function getBalance(id){ return { personal:Number(state.balances[id]?.personal || 0), staging:Number(state.balances[id]?.staging || 0) }; }
function allBills(){ return Object.entries(state.bills).map(([id, bill]) => ({ id, ...bill })); }
function billsForUser(id){ return allBills().filter(bill => bill.userId === id); }
function openBillsForUser(id){ return billsForUser(id).filter(bill => bill.status !== 'paid'); }
function paidBillsForUser(id){ return billsForUser(id).filter(bill => bill.status === 'paid'); }
function ledgerForUser(id){
  return Object.entries(state.ledger)
  .map(([id2, item]) => ({ id:id2, ...item }))
  .filter(item => item.userId === id)
  .sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}
function renderSummary(cards){
  document.getElementById('summary-row').innerHTML = cards.map(card => `
  <div class="col-md-4">
  <div class="glass p-4 h-100">
  <div class="label">${escapeHtml(card.label)}</div>
  <div class="metric mt-2">${escapeHtml(card.value)}</div>
  </div>
  </div>`).join('');
}
function renderTable(headers, rows){
  return `
  <div class="table-responsive">
  <table class="table align-middle mb-0">
  <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
  <tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="text-muted">No records.</td></tr>`}</tbody>
  </table>
  </div>`;
}
function renderLedger(items){
  const pane = document.getElementById('ledger-pane');
  if (!items.length) {
    pane.innerHTML = '<div class="text-muted">No activity yet.</div>';
    return;
  }
  pane.innerHTML = items.slice(0, 20).map(item => `
  <div class="list-row">
  <div class="d-flex justify-content-between gap-3 align-items-start">
  <div>
  <div class="fw-semibold">${escapeHtml(item.title || 'Activity')}</div>
  <div class="text-muted small">${escapeHtml(item.description || '')}</div>
  </div>
  <div class="text-end">
  <div class="fw-semibold">${item.amount != null ? money(item.amount) : ''}</div>
  <div class="text-muted small">${new Date(item.createdAt || Date.now()).toLocaleString()}</div>
  </div>
  </div>
  </div>`).join('');
}

function render(){
  const detail = document.getElementById('detail-pane');
  const subtitle = document.getElementById('window-subtitle');
  const user = getUser(userId);
  const balance = getBalance(userId);
  const openBills = openBillsForUser(userId);
  const paidBills = paidBillsForUser(userId);
  const openBillTotal = openBills.reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
  const ledgerItems = ledgerForUser(userId);

  if (kind === 'checking') {
    document.getElementById('window-title').textContent = `${user.name} · Checking`;
    subtitle.textContent = 'Available cash in checking, plus incoming and outgoing movement.';
    renderSummary([
      { label:'Checking Balance', value: money(balance.personal) },
                  { label:'Open Bills', value: money(openBillTotal) },
                  { label:'Paid Bills', value: String(paidBills.length) }
    ]);
    detail.innerHTML = `<p class="text-muted mb-3">This pane focuses on checking cash and funding activity.</p>` +
    renderTable(['Type','Description','Amount','When'], ledgerItems.filter(item => ['deposit','transfer','client_created'].includes(item.type)).map(item =>
    `<tr><td>${escapeHtml(item.title || item.type)}</td><td>${escapeHtml(item.description || '')}</td><td>${item.amount != null ? money(item.amount) : ''}</td><td>${new Date(item.createdAt || Date.now()).toLocaleString()}</td></tr>`));
    renderLedger(ledgerItems);
    return;
  }

  if (kind === 'staging') {
    document.getElementById('window-title').textContent = `${user.name} · Bill Staging`;
    subtitle.textContent = 'Reserved funds for invoices waiting to be paid.';
    renderSummary([
      { label:'Staging Balance', value: money(balance.staging) },
                  { label:'Open Bills', value: String(openBills.length) },
                  { label:'Coverage Delta', value: money(balance.staging - openBillTotal) }
    ]);
    detail.innerHTML = `<p class="text-muted mb-3">Staging holds reserved funds for bills and outgoing obligations.</p>` +
    renderTable(['Bill','Due Date','Amount','Status'], openBills.map(bill =>
    `<tr><td>${escapeHtml(bill.name)}</td><td>${escapeHtml(bill.dueDate || '—')}</td><td>${money(bill.amount)}</td><td>${escapeHtml(bill.status)}</td></tr>`));
    renderLedger(ledgerItems.filter(item => ['transfer','bill_paid','bill_created'].includes(item.type)));
    return;
  }

  if (kind === 'bills') {
    document.getElementById('window-title').textContent = `${user.name} · Bills`;
    subtitle.textContent = 'Open and paid invoice detail for this account.';
    renderSummary([
      { label:'Open Bill Total', value: money(openBillTotal) },
                  { label:'Open Bills', value: String(openBills.length) },
                  { label:'Paid Bills', value: String(paidBills.length) }
    ]);
    detail.innerHTML = renderTable(['Bill','Due Date','Amount','Status'],
                                   [...openBills, ...paidBills].sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).map(bill =>
                                   `<tr><td>${escapeHtml(bill.name)}</td><td>${escapeHtml(bill.dueDate || '—')}</td><td>${money(bill.amount)}</td><td>${escapeHtml(bill.status)}</td></tr>`));
    renderLedger(ledgerItems.filter(item => ['bill_created','bill_paid'].includes(item.type)));
    return;
  }

  if (kind === 'client_overview') {
    document.getElementById('window-title').textContent = `${user.name} · Client Overview`;
    subtitle.textContent = `Full account summary for ${userId}.`;
    renderSummary([
      { label:'Checking', value: money(balance.personal) },
                  { label:'Staging', value: money(balance.staging) },
                  { label:'Open Bills', value: money(openBillTotal) }
    ]);
    detail.innerHTML = `
    <div class="row g-3 mb-3">
    <div class="col-md-6">
    <div class="glass p-3 h-100">
    <div class="label mb-2">Profile</div>
    <div class="fw-semibold">${escapeHtml(user.name || userId)}</div>
    <div class="text-muted">${escapeHtml(userId)}</div>
    <div class="text-muted">Role: ${escapeHtml(user.role || 'client')}</div>
    <div class="text-muted">Status: ${escapeHtml(user.status || 'active')}</div>
    </div>
    </div>
    <div class="col-md-6">
    <div class="glass p-3 h-100">
    <div class="label mb-2">Bill Summary</div>
    <div class="text-muted">${openBills.length} open bill(s), ${paidBills.length} paid bill(s).</div>
    </div>
    </div>
    </div>` + renderTable(['Bill','Due Date','Amount','Status'],
                          [...openBills, ...paidBills].sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).map(bill =>
                          `<tr><td>${escapeHtml(bill.name)}</td><td>${escapeHtml(bill.dueDate || '—')}</td><td>${money(bill.amount)}</td><td>${escapeHtml(bill.status)}</td></tr>`));
    renderLedger(ledgerItems);
    return;
  }

  if (kind === 'admin_global_cash') {
    const totalCash = Object.values(state.balances).reduce((sum, bal) => sum + Number(bal.personal || 0), 0);
    const userRows = Object.entries(state.users).map(([id, userObj]) => {
      const bal = getBalance(id);
      return `<tr><td>${escapeHtml(userObj.name || id)}<div class="text-muted small">${escapeHtml(id)}</div></td><td>${escapeHtml(userObj.role || '')}</td><td>${money(bal.personal)}</td></tr>`;
    });
    document.getElementById('window-title').textContent = 'Admin · Associated Home Fund';
    subtitle.textContent = 'System-wide view of checking balances.';
    renderSummary([
      { label:'Total Checking', value: money(totalCash) },
                  { label:'Accounts', value: String(Object.keys(state.users).length) },
                  { label:'Clients', value: String(Object.values(state.users).filter(userObj => userObj.role === 'client').length) }
    ]);
    detail.innerHTML = renderTable(['User','Role','Checking'], userRows);
    renderLedger(Object.entries(state.ledger).map(([id, item]) => ({ id, ...item })).sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
    return;
  }

  if (kind === 'admin_global_staging') {
    const totalStaging = Object.values(state.balances).reduce((sum, bal) => sum + Number(bal.staging || 0), 0);
    const rows = Object.entries(state.users)
    .filter(([_, userObj]) => userObj.role === 'client')
    .map(([id, userObj]) => {
      const bal = getBalance(id);
      const userOpenTotal = openBillsForUser(id).reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
      return `<tr><td>${escapeHtml(userObj.name || id)}<div class="text-muted small">${escapeHtml(id)}</div></td><td>${money(bal.staging)}</td><td>${money(userOpenTotal)}</td></tr>`;
    });
    document.getElementById('window-title').textContent = 'Admin · Global Bill Staging';
    subtitle.textContent = 'Reserved funds set aside for all open obligations.';
    renderSummary([
      { label:'Total Staging', value: money(totalStaging) },
                  { label:'Open Bills', value: String(allBills().filter(bill => bill.status !== 'paid').length) },
                  { label:'Open Bill Total', value: money(allBills().filter(bill => bill.status !== 'paid').reduce((sum, bill) => sum + Number(bill.amount || 0), 0)) }
    ]);
    detail.innerHTML = renderTable(['User','Staging','Open Bills'], rows);
    renderLedger(Object.entries(state.ledger).map(([id, item]) => ({ id, ...item })).filter(item => ['transfer','bill_paid','bill_created'].includes(item.type)).sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
    return;
  }

  if (kind === 'admin_open_bills') {
    const rows = allBills().sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).map(bill => {
      const billUser = getUser(bill.userId);
      return `<tr><td>${escapeHtml(billUser.name || bill.userId)}</td><td>${escapeHtml(bill.name)}</td><td>${escapeHtml(bill.dueDate || '—')}</td><td>${money(bill.amount)}</td><td>${escapeHtml(bill.status)}</td></tr>`;
    });
    document.getElementById('window-title').textContent = 'Admin · Open Bills';
    subtitle.textContent = 'System-wide unpaid and historical invoice detail.';
    renderSummary([
      { label:'Open Bill Total', value: money(allBills().filter(bill => bill.status !== 'paid').reduce((sum, bill) => sum + Number(bill.amount || 0), 0)) },
                  { label:'Open Bills', value: String(allBills().filter(bill => bill.status !== 'paid').length) },
                  { label:'Paid Bills', value: String(allBills().filter(bill => bill.status === 'paid').length) }
    ]);
    detail.innerHTML = renderTable(['Client','Bill','Due Date','Amount','Status'], rows);
    renderLedger(Object.entries(state.ledger).map(([id, item]) => ({ id, ...item })).filter(item => ['bill_created','bill_paid'].includes(item.type)).sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
  }
}

// FIXED: Now listens to all 8 nodes
db.ref('users').on('value', snap => { state.users = snap.val() || {}; render(); });
db.ref('balances').on('value', snap => { state.balances = snap.val() || {}; render(); });
db.ref('bills').on('value', snap => { state.bills = snap.val() || {}; render(); });
db.ref('ledger').on('value', snap => { state.ledger = snap.val() || {}; render(); });
db.ref('loans').on('value', snap => { state.loans = snap.val() || {}; });
db.ref('logs').on('value', snap => { state.logs = snap.val() || {}; });
db.ref('masterBankLedger').on('value', snap => { state.masterBankLedger = snap.val() || {}; });
db.ref('system').on('value', snap => { state.system = snap.val() || {}; });

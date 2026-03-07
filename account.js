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
let users = {}, bills = {}, ledger = {};

function money(n){ return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n || 0)); }
function ledgerItemsForUser(uid){
  return Object.values(ledger).filter(x => x.userId === uid).sort((a,b) => new Date(b.createdAt||0)-new Date(a.createdAt||0));
}
function openBillsForUser(uid){ return Object.values(bills).filter(b => b.userId === uid && b.status === 'open'); }
function paidBillsForUser(uid){ return Object.values(bills).filter(b => b.userId === uid && b.status === 'paid'); }
function renderSummary(cards){
  document.getElementById('summary-row').innerHTML = cards.map(card => `
    <div class="col-md-4">
      <div class="card p-4 h-100"><div class="label">${card.label}</div><h3 class="mt-2 mb-0">${card.value}</h3></div>
    </div>`).join('');
}
function renderLedger(items){
  const pane = document.getElementById('ledger-pane');
  if (!items.length){ pane.innerHTML = '<div class="text-muted">No activity yet.</div>'; return; }
  pane.innerHTML = items.slice(0,20).map(item => `
    <div class="border-bottom py-3">
      <div class="d-flex justify-content-between gap-3">
        <div><div class="fw-semibold">${item.title || 'Activity'}</div><div class="text-muted small">${item.description || ''}</div></div>
        <div class="text-end"><div class="fw-semibold">${item.amount != null ? money(item.amount) : ''}</div><div class="text-muted small">${new Date(item.createdAt || Date.now()).toLocaleString()}</div></div>
      </div>
    </div>`).join('');
}
function renderTable(headers, rows){
  return `
    <div class="table-responsive">
      <table class="table align-middle mb-0">
        <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="text-muted">No records.</td></tr>`}</tbody>
      </table>
    </div>`;
}
function render(){
  const user = users[userId] || { name:userId, balances:{personal:0,staging:0}, role:'unknown' };
  const detail = document.getElementById('detail-pane');
  const subtitle = document.getElementById('window-subtitle');

  if (kind === 'checking'){
    document.getElementById('window-title').textContent = `${user.name} · Checking`;
    subtitle.textContent = 'Dedicated checking account window';
    renderSummary([
      { label:'Checking Balance', value: money(user.balances?.personal || 0) },
      { label:'Open Bills', value: money(openBillsForUser(userId).reduce((s,b)=>s+Number(b.amount||0),0)) },
      { label:'Paid Bills', value: String(paidBillsForUser(userId).length) }
    ]);
    detail.innerHTML = `<p class="mb-3">This account shows available checking funds for deposits and transfers.</p>` +
      renderTable(['Type','Description','Amount','When'], ledgerItemsForUser(userId).filter(x => ['deposit','transfer','client_created'].includes(x.type)).slice(0,15).map(item =>
        `<tr><td>${item.title || item.type}</td><td>${item.description || ''}</td><td>${item.amount != null ? money(item.amount) : ''}</td><td>${new Date(item.createdAt||Date.now()).toLocaleString()}</td></tr>`));
    renderLedger(ledgerItemsForUser(userId));
    return;
  }

  if (kind === 'staging'){
    document.getElementById('window-title').textContent = `${user.name} · Bill Staging`;
    subtitle.textContent = 'Reserved funds for invoice payment';
    renderSummary([
      { label:'Staging Balance', value: money(user.balances?.staging || 0) },
      { label:'Open Bills', value: String(openBillsForUser(userId).length) },
      { label:'Coverage Delta', value: money((user.balances?.staging || 0) - openBillsForUser(userId).reduce((s,b)=>s+Number(b.amount||0),0)) }
    ]);
    detail.innerHTML = `<p class="mb-3">Staging funds are set aside to pay recorded bills.</p>` +
      renderTable(['Bill','Due Date','Amount','Status'], openBillsForUser(userId).map(b =>
        `<tr><td>${b.name}</td><td>${b.dueDate || '—'}</td><td>${money(b.amount)}</td><td><span class="badge bg-warning text-dark">${b.status}</span></td></tr>`));
    renderLedger(ledgerItemsForUser(userId).filter(x => ['transfer','bill_paid','bill_created'].includes(x.type)));
    return;
  }

  if (kind === 'bills'){
    document.getElementById('window-title').textContent = `${user.name} · Bills`;
    subtitle.textContent = 'Open and paid invoice detail';
    renderSummary([
      { label:'Open Bill Total', value: money(openBillsForUser(userId).reduce((s,b)=>s+Number(b.amount||0),0)) },
      { label:'Open Bills', value: String(openBillsForUser(userId).length) },
      { label:'Paid Bills', value: String(paidBillsForUser(userId).length) }
    ]);
    detail.innerHTML = renderTable(['Bill','Due','Amount','Status'],
      [...openBillsForUser(userId), ...paidBillsForUser(userId)].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).map(b =>
        `<tr><td>${b.name}</td><td>${b.dueDate || '—'}</td><td>${money(b.amount)}</td><td><span class="badge ${b.status === 'paid' ? 'bg-success' : 'bg-warning text-dark'}">${b.status}</span></td></tr>`));
    renderLedger(ledgerItemsForUser(userId).filter(x => ['bill_created','bill_paid'].includes(x.type)));
    return;
  }

  if (kind === 'client_overview'){
    document.getElementById('window-title').textContent = `${user.name} · Client Overview`;
    subtitle.textContent = `Client account window for ${userId}`;
    renderSummary([
      { label:'Checking', value: money(user.balances?.personal || 0) },
      { label:'Staging', value: money(user.balances?.staging || 0) },
      { label:'Open Bills', value: money(openBillsForUser(userId).reduce((s,b)=>s+Number(b.amount||0),0)) }
    ]);
    detail.innerHTML = `<div class="row g-3">
      <div class="col-md-6"><div class="card p-3 h-100"><div class="label">Profile</div><div class="mt-2"><strong>${user.name}</strong><div class="text-muted">${userId}</div><div class="text-muted">Role: ${user.role}</div><div class="text-muted">Status: ${user.status || 'active'}</div></div></div></div>
      <div class="col-md-6"><div class="card p-3 h-100"><div class="label">Bill Summary</div><div class="mt-2 text-muted">${openBillsForUser(userId).length} open bill(s), ${paidBillsForUser(userId).length} paid.</div></div></div>
    </div>`;
    renderLedger(ledgerItemsForUser(userId));
    return;
  }

  if (kind === 'admin_global_cash'){
    const totalCash = Object.values(users).reduce((s,u)=>s+Number(u.balances?.personal||0),0);
    document.getElementById('window-title').textContent = 'Admin · Associated Home Fund';
    subtitle.textContent = 'All client and admin checking balances';
    renderSummary([
      { label:'Total Checking', value: money(totalCash) },
      { label:'Accounts', value: String(Object.keys(users).length) },
      { label:'Clients', value: String(Object.values(users).filter(u=>u.role==='client').length) }
    ]);
    detail.innerHTML = renderTable(['User','Role','Checking'], Object.entries(users).map(([uid,u]) =>
      `<tr><td>${u.name || uid}<div class="text-muted small">${uid}</div></td><td>${u.role}</td><td>${money(u.balances?.personal || 0)}</td></tr>`));
    renderLedger(Object.values(ledger).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)));
    return;
  }

  if (kind === 'admin_global_staging'){
    const totalStaging = Object.values(users).reduce((s,u)=>s+Number(u.balances?.staging||0),0);
    document.getElementById('window-title').textContent = 'Admin · Global Bill Staging';
    subtitle.textContent = 'All reserved bill funds';
    renderSummary([
      { label:'Total Staging', value: money(totalStaging) },
      { label:'Open Bills', value: String(Object.values(bills).filter(b=>b.status==='open').length) },
      { label:'Open Bill Total', value: money(Object.values(bills).filter(b=>b.status==='open').reduce((s,b)=>s+Number(b.amount||0),0)) }
    ]);
    detail.innerHTML = renderTable(['User','Staging','Open Bills'], Object.entries(users).filter(([_,u]) => u.role === 'client').map(([uid,u]) =>
      `<tr><td>${u.name || uid}<div class="text-muted small">${uid}</div></td><td>${money(u.balances?.staging || 0)}</td><td>${money(openBillsForUser(uid).reduce((s,b)=>s+Number(b.amount||0),0))}</td></tr>`));
    renderLedger(Object.values(ledger).filter(x => ['transfer','bill_paid','bill_created'].includes(x.type)).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)));
    return;
  }

  if (kind === 'admin_open_bills'){
    document.getElementById('window-title').textContent = 'Admin · Open Bills';
    subtitle.textContent = 'System-wide unpaid bills';
    renderSummary([
      { label:'Open Bill Total', value: money(Object.values(bills).filter(b=>b.status==='open').reduce((s,b)=>s+Number(b.amount||0),0)) },
      { label:'Open Bills', value: String(Object.values(bills).filter(b=>b.status==='open').length) },
      { label:'Paid Bills', value: String(Object.values(bills).filter(b=>b.status==='paid').length) }
    ]);
    detail.innerHTML = renderTable(['Client','Bill','Due','Amount','Status'], Object.values(bills).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).map(b => {
      const user = users[b.userId] || {};
      return `<tr><td>${user.name || b.userId}</td><td>${b.name}</td><td>${b.dueDate || '—'}</td><td>${money(b.amount)}</td><td><span class="badge ${b.status === 'paid' ? 'bg-success' : 'bg-warning text-dark'}">${b.status}</span></td></tr>`;
    }));
    renderLedger(Object.values(ledger).filter(x => ['bill_created','bill_paid'].includes(x.type)).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)));
    return;
  }
}

db.ref('users').on('value', snap => { users = snap.val() || {}; render(); });
db.ref('bills').on('value', snap => { bills = snap.val() || {}; render(); });
db.ref('ledger').on('value', snap => { ledger = snap.val() || {}; render(); });

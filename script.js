const firebaseConfig = {
  databaseURL: 'https://homefund-3b81a-default-rtdb.firebaseio.com/',
  projectId: 'homefund-3b81a',
  authDomain: 'homefund-3b81a.firebaseapp.com',
  storageBucket: 'homefund-3b81a.appspot.com'
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const SESSION_KEY = 'hfc_active_user';
let currentUser = null;
let systemUsers = {};
let systemBills = {};
let systemLedger = {};
let clientModal, billModal, transferModal;
let activeBillContext = 'admin';
let clockTimer = null;

function money(n){
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n || 0));
}
function nowIso(){ return new Date().toISOString(); }
function uid(prefix='id'){ return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
function sanitizeName(v){ return String(v || '').trim(); }

// FIXED: Number validation to prevent NaN corruption
function toAmount(v){
  const num = Number(v);
  if (isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function showToast(message, type='info'){
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast align-items-center text-white bg-${type === 'danger' ? 'danger' : type} border-0 show mb-2`;
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${message}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function showLoginError(msg){
  const err = document.getElementById('login-err');
  err.textContent = msg;
  err.classList.remove('d-none');
}
function clearLoginError(){ document.getElementById('login-err').classList.add('d-none'); }
function setSession(user){ localStorage.setItem(SESSION_KEY, user); }
function clearSession(){ localStorage.removeItem(SESSION_KEY); }
function getOpenBillsForUser(userId){
  return Object.values(systemBills).filter(b => b.userId === userId && b.status === 'open');
}
function getOpenBillTotalForUser(userId){
  return getOpenBillsForUser(userId).reduce((sum,b) => sum + Number(b.amount || 0), 0);
}
function getSystemOpenBillTotal(){
  return Object.values(systemBills).filter(b => b.status === 'open').reduce((sum,b) => sum + Number(b.amount || 0), 0);
}
function buildLedgerItemsForUser(userId){
  return Object.entries(systemLedger)
  .map(([id, item]) => ({ id, ...item }))
  .filter(item => item.userId === userId)
  .sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}
function buildSystemLedgerItems(){
  return Object.entries(systemLedger)
  .map(([id, item]) => ({ id, ...item }))
  .sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}
function renderLedgerFeed(targetId, items){
  const target = document.getElementById(targetId);
  if (!target) return;
  if (!items.length){
    target.innerHTML = '<div class="text-muted py-3">No activity yet.</div>';
    return;
  }
  target.innerHTML = items.slice(0, 12).map(item => `
  <div class="list-group-item border-0 border-bottom px-0 ledger-row">
  <div class="d-flex justify-content-between gap-3">
  <div>
  <div class="fw-semibold">${item.title || 'Ledger Event'}</div>
  <small>${item.description || ''}</small>
  </div>
  <div class="text-end">
  <div class="fw-semibold">${item.amount != null ? money(item.amount) : ''}</div>
  <small>${new Date(item.createdAt || Date.now()).toLocaleString()}</small>
  </div>
  </div>
  </div>`).join('');
}
function updateSessionUserLabel(){
  const label = document.getElementById('session-user-label');
  if (!currentUser || !systemUsers[currentUser]) return label.textContent = '';
  const u = systemUsers[currentUser];
  label.textContent = `${u.name || currentUser} · ${u.role}`;
}
function switchView(name){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(`view-${name}`);
  if (el) el.classList.add('active');
}
function renderAdminTable(){
  const body = document.getElementById('adminUsersBody');
  if (!body) return;
  const rows = Object.entries(systemUsers)
  .filter(([_,u]) => u.role !== 'admin')
  .sort((a,b) => (a[1].name || '').localeCompare(b[1].name || ''));
  if (!rows.length){
    body.innerHTML = '<tr><td colspan="5" class="text-muted">No client accounts yet.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(([userId,u]) => `
  <tr>
  <td><strong>${u.name || userId}</strong><br><small class="text-muted">${userId}</small></td>
  <td class="text-success fw-semibold">${money(u.balances?.personal || 0)}</td>
  <td class="text-info fw-semibold">${money(u.balances?.staging || 0)}</td>
  <td class="text-danger fw-semibold">${money(getOpenBillTotalForUser(userId))}</td>
  <td>
  <div class="d-flex gap-2 flex-wrap">
  <button class="btn btn-sm btn-outline-primary" onclick="openDedicatedWindow('client_overview','${userId}')">Open</button>
  <button class="btn btn-sm btn-outline-success" onclick="adminDepositPrompt('${userId}')">Deposit</button>
  <button class="btn btn-sm btn-outline-dark" onclick="prefillBillUser('${userId}')">Bill</button>
  </div>
  </td>
  </tr>`).join('');
}
function populateBillUserOptions(){
  const select = document.getElementById('bill-user');
  if (!select) return;
  const clients = Object.entries(systemUsers).filter(([_,u]) => u.role === 'client');
  select.innerHTML = clients.map(([userId,u]) => `<option value="${userId}">${u.name || userId} (${userId})</option>`).join('');
}
function updateDashboard(){
  const users = Object.values(systemUsers);
  const totalCash = users.reduce((sum,u) => sum + Number(u.balances?.personal || 0), 0);
  const totalStaging = users.reduce((sum,u) => sum + Number(u.balances?.staging || 0), 0);
  document.getElementById('admin-total-cash').textContent = money(totalCash);
  document.getElementById('admin-total-staging').textContent = money(totalStaging);
  document.getElementById('admin-open-bills-total').textContent = money(getSystemOpenBillTotal());

  if (currentUser && systemUsers[currentUser]){
    const u = systemUsers[currentUser];
    document.getElementById('client-welcome-name').textContent = `Welcome, ${u.name || currentUser}`;
    document.getElementById('dash-personal-bal').textContent = money(u.balances?.personal || 0);
    document.getElementById('dash-staging-bal').textContent = money(u.balances?.staging || 0);
    document.getElementById('client-total-due').textContent = money(getOpenBillTotalForUser(currentUser));
    renderLedgerFeed('client-ledger-feed', buildLedgerItemsForUser(currentUser));
  }

  renderAdminTable();
  populateBillUserOptions();
  renderLedgerFeed('admin-ledger-feed', buildSystemLedgerItems());
  updateSessionUserLabel();
}
function ensureDefaultAdmin(){
  db.ref('users/admin').transaction(curr => curr || {
    name:'System Admin', pin:'0000', role:'admin', status:'active',
    balances:{personal:0, staging:0}, createdAt: nowIso()
  });
}

// FIXED: Display styling logic so the page doesn't scroll
function authenticateUser(){
  const rawUser = sanitizeName(document.getElementById('login-user').value).toLowerCase();
  const pin = sanitizeName(document.getElementById('login-pin').value);
  if (!rawUser || !pin) return showLoginError('Missing credentials.');
  clearLoginError();

  const fallbackAdmin = rawUser === 'admin' && pin === '0000';
  const dbUser = systemUsers[rawUser];
  const dbAuth = dbUser && String(dbUser.pin) === pin && dbUser.status === 'active';
  if (!fallbackAdmin && !dbAuth) return showLoginError('Authentication failed.');

  currentUser = rawUser;
  setSession(rawUser);

  document.getElementById('login-wrapper').classList.replace('d-flex', 'd-none');
  document.getElementById('app-wrapper').style.display = 'block';

  if (systemUsers[rawUser]?.role === 'admin' || rawUser === 'admin') switchView('admin');
  else switchView('client');
  updateDashboard();
  showToast(`Secure session established for ${rawUser}.`, 'primary');
}

// FIXED: Display styling logic to restore login view correctly
function logoutUser(){
  currentUser = null;
  clearSession();

  document.getElementById('app-wrapper').style.display = 'none';
  document.getElementById('login-wrapper').classList.replace('d-none', 'd-flex');

  document.getElementById('login-user').value = '';
  document.getElementById('login-pin').value = '';
  showToast('Session terminated.', 'secondary');
}

// FIXED: Display styling logic for page reloads
function restoreSession(){
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return;
  if (!systemUsers[saved]) return clearSession();

  currentUser = saved;
  document.getElementById('login-wrapper').classList.replace('d-flex', 'd-none');
  document.getElementById('app-wrapper').style.display = 'block';
  switchView(systemUsers[saved].role === 'admin' ? 'admin' : 'client');
  updateDashboard();
}

function appendLedger(entry){
  return db.ref(`ledger/${uid('led')}`).set({ createdAt: nowIso(), ...entry });
}
async function createClient(){
  const username = sanitizeName(document.getElementById('new-client-username').value).toLowerCase();
  const name = sanitizeName(document.getElementById('new-client-name').value);
  const pin = sanitizeName(document.getElementById('new-client-pin').value);
  const opening = toAmount(document.getElementById('new-client-opening').value);
  if (!username || !name || !pin) return showToast('Complete all client fields.', 'danger');
  if (systemUsers[username]) return showToast('Username already exists.', 'danger');

  const payload = {
    name, pin, role:'client', status:'active', createdAt: nowIso(),
    balances:{ personal: opening, staging: 0 }
  };
  await db.ref(`users/${username}`).set(payload);
  await appendLedger({ userId: username, type:'client_created', title:'Client Created', description:`${name} account opened.`, amount: opening, actor: currentUser });
  if (opening > 0){
    await appendLedger({ userId: username, type:'deposit', title:'Opening Deposit', description:'Opening balance posted to checking.', amount: opening, actor: currentUser });
  }
  clientModal.hide();
  showToast(`${name} created successfully.`, 'success');
}
function prefillBillUser(userId){
  activeBillContext = 'admin';
  populateBillUserOptions();
  document.getElementById('bill-user').value = userId;
  billModal.show();
}
async function createBill(){
  const userId = document.getElementById('bill-user').value || currentUser;
  const name = sanitizeName(document.getElementById('bill-name').value);
  const amount = toAmount(document.getElementById('bill-amount').value);
  const dueDate = document.getElementById('bill-due-date').value || '';
  if (!userId || !name || amount <= 0) return showToast('Enter a valid bill.', 'danger');
  const billId = uid('bill');
  await db.ref(`bills/${billId}`).set({
    userId, name, amount, dueDate, status:'open', createdAt: nowIso(), createdBy: currentUser
  });
  await appendLedger({ userId, type:'bill_created', title:'Bill Recorded', description:`${name}${dueDate ? ` · due ${dueDate}` : ''}`, amount, actor: currentUser, billId });
  billModal.hide();
  ['bill-name','bill-amount','bill-due-date'].forEach(id => document.getElementById(id).value = '');
  showToast('Bill recorded.', 'success');
}
async function runUserBalanceTransaction(userId, mutator){
  return db.ref(`users/${userId}/balances`).transaction(curr => {
    const balances = curr || { personal:0, staging:0 };
    const next = mutator({
      personal: Number(balances.personal || 0),
                         staging: Number(balances.staging || 0)
    });
    return next;
  });
}
async function createDeposit(userId, amount){
  amount = toAmount(amount);
  if (amount <= 0) throw new Error('Invalid deposit amount.');
  await runUserBalanceTransaction(userId, balances => ({ ...balances, personal: toAmount(balances.personal + amount) }));
  await appendLedger({ userId, type:'deposit', title:'Deposit Posted', description:'Deposit to checking.', amount, actor: currentUser });
}
async function createTransfer(){
  const direction = document.getElementById('transfer-direction').value;
  const amount = toAmount(document.getElementById('transfer-amount').value);
  if (amount <= 0) return showToast('Enter a valid transfer amount.', 'danger');
  let insufficient = false;
  await runUserBalanceTransaction(currentUser, balances => {
    if (direction === 'personal_to_staging'){
      if (balances.personal < amount){ insufficient = true; return; }
      return { personal: toAmount(balances.personal - amount), staging: toAmount(balances.staging + amount) };
    }
    if (balances.staging < amount){ insufficient = true; return; }
    return { personal: toAmount(balances.personal + amount), staging: toAmount(balances.staging - amount) };
  });
  if (insufficient) return showToast('Insufficient funds.', 'danger');
  await appendLedger({
    userId: currentUser,
    type:'transfer',
    title:'Balance Transfer',
    description: direction === 'personal_to_staging' ? 'Checking → Staging' : 'Staging → Checking',
    amount,
    actor: currentUser
  });
  transferModal.hide();
  document.getElementById('transfer-amount').value = '';
  showToast('Transfer complete.', 'success');
}
async function adminDepositPrompt(userId){
  const input = window.prompt(`Deposit amount for ${userId}:`, '0.00');
  if (input == null) return;
  try{
    await createDeposit(userId, input);
    showToast('Deposit posted.', 'success');
  }catch(err){
    showToast(err.message, 'danger');
  }
}
function openDedicatedWindow(kind, userId=currentUser){
  const url = `account.html?kind=${encodeURIComponent(kind)}&user=${encodeURIComponent(userId)}`;
  window.open(url, '_blank', 'width=1100,height=800,resizable=yes,scrollbars=yes');
}
function startClock(){
  if (clockTimer) clearInterval(clockTimer);
  const render = () => document.getElementById('clockTime').textContent = new Date().toLocaleTimeString([], { hour12:false });
  render();
  clockTimer = setInterval(render, 1000);
}
function wireEvents(){
  clientModal = new bootstrap.Modal(document.getElementById('clientModal'));
  billModal = new bootstrap.Modal(document.getElementById('billModal'));
  transferModal = new bootstrap.Modal(document.getElementById('transferModal'));

  document.getElementById('login-btn').addEventListener('click', authenticateUser);
  document.getElementById('logout-btn').addEventListener('click', logoutUser);
  document.getElementById('save-client-btn').addEventListener('click', createClient);
  document.getElementById('save-bill-btn').addEventListener('click', createBill);
  document.getElementById('save-transfer-btn').addEventListener('click', createTransfer);
  document.getElementById('open-create-client-modal').addEventListener('click', () => clientModal.show());
  document.getElementById('open-create-bill-modal-admin').addEventListener('click', () => { activeBillContext = 'admin'; populateBillUserOptions(); billModal.show(); });
  document.getElementById('open-create-bill-modal-client').addEventListener('click', () => {
    activeBillContext = 'client'; populateBillUserOptions(); document.getElementById('bill-user').value = currentUser; billModal.show();
  });
  document.getElementById('open-transfer-modal').addEventListener('click', () => transferModal.show());
  document.getElementById('login-user').addEventListener('keyup', e => e.key === 'Enter' && authenticateUser());
  document.getElementById('login-pin').addEventListener('keyup', e => e.key === 'Enter' && authenticateUser());
  document.querySelectorAll('[data-open-window]').forEach(el => {
    el.addEventListener('click', () => openDedicatedWindow(el.dataset.openWindow));
  });
}

function attachListeners(){
  db.ref('users').on('value', snap => {
    systemUsers = snap.val() || {};
    updateDashboard();
  });
  db.ref('bills').on('value', snap => {
    systemBills = snap.val() || {};
    updateDashboard();
  });
  db.ref('ledger').on('value', snap => {
    systemLedger = snap.val() || {};
    updateDashboard();
  });
}

// FIXED: Restores session once on load
document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  ensureDefaultAdmin();
  attachListeners();
  startClock();
  restoreSession();
});

const firebaseConfig = {
  databaseURL: 'https://homefund-3b81a-default-rtdb.firebaseio.com/',
  projectId: 'homefund-3b81a',
  authDomain: 'homefund-3b81a.firebaseapp.com',
  storageBucket: 'homefund-3b81a.appspot.com'
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const SESSION_KEY = 'hfc_session_v2';
const DEFAULT_ADMIN = {
  name: 'System Admin',
  pin: '0000',
  role: 'admin',
  status: 'active'
};

const state = {
  currentUser: null,
  users: {},
  balances: {},
  bills: {},
  ledger: {},
  loans: {},
  logs: {},
  masterBankLedger: {},
  system: {},
  clockTimer: null,
  listenersReady: false
};

const els = {};
let modals = {};

function qs(id){ return document.getElementById(id); }
function money(n){ return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0)); }
function sanitizeUserId(value){ return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''); }
function parseAmount(value){ const n = Number(value); return Number.isFinite(n) ? Number(n.toFixed(2)) : NaN; }
function uid(prefix='id'){ return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function nowIso(){ return new Date().toISOString(); }
function escapeHtml(value){ return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }

function getUser(userId){
  if (userId === 'admin') return { ...DEFAULT_ADMIN, ...(state.users.admin || {}) };
  return state.users[userId] || null;
}

function getBalance(userId){
  return {
    personal: Number(state.balances[userId]?.personal || 0),
    staging: Number(state.balances[userId]?.staging || 0)
  };
}

function getAllBills(){ return Object.entries(state.bills).map(([id, bill]) => ({ id, ...bill })); }
function getBillsForUser(userId){ return getAllBills().filter(bill => bill.userId === userId); }
function getOpenBillsForUser(userId){ return getBillsForUser(userId).filter(bill => bill.status !== 'paid' && bill.status !== 'split'); }
function getPaidBillsForUser(userId){ return getBillsForUser(userId).filter(bill => bill.status === 'paid'); }
function openBillTotalForUser(userId){ return getOpenBillsForUser(userId).reduce((sum, bill) => sum + Number(bill.amount || 0), 0); }
function getLedgerItems(userId=null){
  const items = Object.entries(state.ledger).map(([id, item]) => ({ id, ...item }));
  const filtered = userId ? items.filter(item => item.userId === userId) : items;
  return filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function showToast(message, type='info'){
  const container = qs('toast-container');
  if (!container) return;
  const iconMap = { success:'circle-check', danger:'triangle-exclamation', warning:'circle-exclamation', info:'circle-info' };
  const toast = document.createElement('div');
  toast.className = `alert alert-${type} border-0 shadow-lg mb-2`;
  toast.style.background = 'rgba(12, 22, 36, .92)';
  toast.style.color = '#eef6ff';
  toast.style.borderRadius = '16px';
  toast.innerHTML = `<i class="fa-solid fa-${iconMap[type] || 'circle-info'} me-2"></i>${escapeHtml(message)}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    toast.style.transition = 'all .22s ease';
    setTimeout(() => toast.remove(), 240);
  }, 3000);
}

function showLoginError(message){
  els.loginErr.textContent = message;
  els.loginErr.classList.remove('d-none');
}

function clearLoginError(){
  els.loginErr.textContent = '';
  els.loginErr.classList.add('d-none');
}

function persistSession(){
  if (!state.currentUser) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: state.currentUser }));
}

function restoreSession(){
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!session?.userId) return;
    const user = getUser(session.userId);
    if (user && user.status !== 'disabled') {
      state.currentUser = session.userId;
      showApp();
    }
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
}

function switchView(viewName){
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  qs(`view-${viewName}`)?.classList.add('active');
}

// FIXED: Removed the d-flex class so the login page completely vanishes
function showApp(){
  if (!state.currentUser) return;

  els.loginWrapper.classList.replace('d-flex', 'd-none');
  els.appWrapper.style.display = 'block';

  const user = getUser(state.currentUser);
  const role = user?.role || 'client';
  els.sessionUserLabel.textContent = `${user?.name || state.currentUser} · ${role}`;
  if (role === 'admin') {
    switchView('admin');
  } else {
    switchView('client');
    els.clientWelcomeName.textContent = `Welcome, ${user?.name || state.currentUser}`;
  }
  persistSession();
  render();
  startClock();
}

function showLogin(){
  state.currentUser = null;
  els.appWrapper.style.display = 'none';

  els.loginWrapper.classList.replace('d-none', 'd-flex');

  els.loginPin.value = '';
  persistSession();
}

function startClock(){
  if (state.clockTimer) return;
  const tick = () => { els.clockTime.textContent = new Date().toLocaleTimeString([], { hour12:false }); };
  tick();
  state.clockTimer = setInterval(tick, 1000);
}

async function ensureAdminBootstrap(){
  const usersRef = db.ref('users/admin');
  const balancesRef = db.ref('balances/admin');
  const [userSnap, balanceSnap] = await Promise.all([usersRef.get(), balancesRef.get()]);
  const writes = [];
  if (!userSnap.exists()) writes.push(usersRef.set(DEFAULT_ADMIN));
  if (!balanceSnap.exists()) writes.push(balancesRef.set({ personal:0, staging:0 }));
  if (writes.length) await Promise.all(writes);
}

function authenticateUser(){
  clearLoginError();
  const userId = sanitizeUserId(els.loginUser.value);
  const pin = String(els.loginPin.value || '').trim();

  if (!userId || !pin) return showLoginError('Missing credentials.');

  const user = getUser(userId);
  if (!user || user.status === 'disabled') return showLoginError('Account not found or disabled.');
  if (String(user.pin) !== pin) return showLoginError('Authentication failed.');

  state.currentUser = userId;
  els.loginPin.value = '';
  showApp();
  showToast(`Secure session established for ${user.name || userId}.`, 'success');
}

function logoutUser(){
  showToast('Session terminated.', 'warning');
  showLogin();
}

function populateClientSelect(selectId, options={ includeAdmin:false, placeholder:null }){
  const select = qs(selectId);
  if (!select) return;
  const users = Object.entries(state.users)
  .filter(([id, user]) => options.includeAdmin || user.role !== 'admin')
  .sort((a,b) => (a[1].name || a[0]).localeCompare(b[1].name || b[0]));

  const html = [];
  if (options.placeholder) html.push(`<option value="">${escapeHtml(options.placeholder)}</option>`);
  users.forEach(([userId, user]) => {
    html.push(`<option value="${escapeHtml(userId)}">${escapeHtml(user.name || userId)} (${escapeHtml(userId)})</option>`);
  });
  select.innerHTML = html.join('');
}

function populatePayBillSelect(){
  const select = els.payBillSelect;
  if (!select) return;
  const userId = state.currentUser;
  const openBills = getOpenBillsForUser(userId);
  if (!openBills.length) {
    select.innerHTML = '<option value="">No open bills</option>';
    return;
  }
  select.innerHTML = openBills
  .sort((a,b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0))
  .map(bill => `<option value="${escapeHtml(bill.id)}">${escapeHtml(bill.name)} · ${money(bill.amount)}${bill.dueDate ? ` · due ${escapeHtml(bill.dueDate)}` : ''}</option>`)
  .join('');
}

// NEW: Populates the dropdown selector for the split bill feature
function populateSplitBillSelect(){
  const select = els.splitBillSelect;
  if (!select) return;
  const openBills = getAllBills().filter(b => b.status === 'open');
  if (!openBills.length) {
    select.innerHTML = '<option value="">No open bills available</option>';
    return;
  }
  select.innerHTML = openBills
  .sort((a,b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
  .map(b => `<option value="${b.id}">${escapeHtml(b.name)} · ${money(b.amount)} (Currently billed to ${escapeHtml(getUser(b.userId)?.name || b.userId)})</option>`)
  .join('');
}

function openWindow(kind, userId=state.currentUser){
  const url = `account.html?kind=${encodeURIComponent(kind)}&user=${encodeURIComponent(userId)}`;
  window.open(url, '_blank', 'width=1180,height=860,resizable=yes,scrollbars=yes');
}

function renderLedgerFeed(targetId, items){
  const target = qs(targetId);
  if (!target) return;
  if (!items.length) {
    target.innerHTML = '<div class="list-group-item text-muted">No activity yet.</div>';
    return;
  }
  target.innerHTML = items.slice(0, 12).map(item => `
  <div class="list-group-item">
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

function renderAdminUsers(){
  const tbody = els.adminUsersBody;
  const rows = Object.entries(state.users)
  .filter(([_, user]) => user.role !== 'admin')
  .sort((a,b) => (a[1].name || a[0]).localeCompare(b[1].name || b[0]))
  .map(([userId, user]) => {
    const balance = getBalance(userId);
    const openTotal = openBillTotalForUser(userId);
    return `
    <tr>
    <td>
    <div class="fw-semibold">${escapeHtml(user.name || userId)}</div>
    <div class="text-muted small">${escapeHtml(userId)} · ${escapeHtml(user.status || 'active')}</div>
    </td>
    <td>${money(balance.personal)}</td>
    <td>${money(balance.staging)}</td>
    <td>${money(openTotal)}</td>
    <td>
    <div class="action-stack">
    <button class="btn btn-sm btn-outline-light" data-action="open-overview" data-user="${escapeHtml(userId)}"><i class="fa-solid fa-up-right-from-square me-1"></i>Open</button>
    <button class="btn btn-sm btn-outline-light" data-action="deposit" data-user="${escapeHtml(userId)}"><i class="fa-solid fa-money-bill-wave me-1"></i>Deposit</button>
    <button class="btn btn-sm btn-outline-light" data-action="pay-next" data-user="${escapeHtml(userId)}"><i class="fa-solid fa-circle-check me-1"></i>Pay</button>
    </div>
    </td>
    </tr>`;
  });

  tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="5" class="text-muted">No clients yet.</td></tr>';
}

function render(){
  const totalCash = Object.values(state.balances).reduce((sum, bal) => sum + Number(bal.personal || 0), 0);
  const totalStaging = Object.values(state.balances).reduce((sum, bal) => sum + Number(bal.staging || 0), 0);
  const openBills = getAllBills().filter(bill => bill.status === 'open');
  const openBillTotal = openBills.reduce((sum, bill) => sum + Number(bill.amount || 0), 0);

  els.adminTotalCash.textContent = money(totalCash);
  els.adminTotalStaging.textContent = money(totalStaging);
  els.adminOpenBillsTotal.textContent = money(openBillTotal);

  if (state.currentUser) {
    const balance = getBalance(state.currentUser);
    els.dashPersonalBal.textContent = money(balance.personal);
    els.dashStagingBal.textContent = money(balance.staging);
    els.clientTotalDue.textContent = money(openBillTotalForUser(state.currentUser));
  }

  renderAdminUsers();
  renderLedgerFeed('admin-ledger-feed', getLedgerItems());
  renderLedgerFeed('client-ledger-feed', getLedgerItems(state.currentUser));
  populateClientSelect('bill-user', { placeholder:'Select client' });
  populateClientSelect('deposit-user', { placeholder:'Select client' });
  populatePayBillSelect();
  populateSplitBillSelect(); // Make sure the split dropdown stays current
}

function attachRealtimeListeners(){
  if (state.listenersReady) return;
  state.listenersReady = true;
  db.ref('users').on('value', snap => {
    state.users = snap.val() || {};
    if (!state.users.admin) state.users.admin = { ...DEFAULT_ADMIN };
    if (state.currentUser && !getUser(state.currentUser)) {
      showToast('Your account is no longer available.', 'warning');
      showLogin();
      return;
    }
    if (!state.currentUser) restoreSession();
    render();
  });
  db.ref('balances').on('value', snap => { state.balances = snap.val() || {}; render(); });
  db.ref('bills').on('value', snap => { state.bills = snap.val() || {}; render(); });
  db.ref('ledger').on('value', snap => { state.ledger = snap.val() || {}; render(); });
  db.ref('loans').on('value', snap => { state.loans = snap.val() || {}; });
  db.ref('logs').on('value', snap => { state.logs = snap.val() || {}; });
  db.ref('masterBankLedger').on('value', snap => { state.masterBankLedger = snap.val() || {}; });
  db.ref('system').on('value', snap => { state.system = snap.val() || {}; });
}

async function appendLedger(entry){
  const id = uid('ledger');
  await db.ref(`ledger/${id}`).set({ createdAt: nowIso(), ...entry });
}

function updateBalanceTransaction(userId, updater){
  return db.ref(`balances/${userId}`).transaction(current => {
    const base = {
      personal: Number(current?.personal || 0),
                                                  staging: Number(current?.staging || 0)
    };
    return updater(base);
  });
}

async function createClient(){
  const userId = sanitizeUserId(els.newClientUsername.value);
  const name = String(els.newClientName.value || '').trim();
  const pin = String(els.newClientPin.value || '').trim();
  const opening = parseAmount(els.newClientOpening.value);

  if (!userId || !name || !pin) return showToast('Fill out username, full name, and PIN.', 'warning');
  if (Number.isNaN(opening) || opening < 0) return showToast('Opening deposit must be zero or more.', 'warning');
  if (getUser(userId)) return showToast('That username already exists.', 'warning');

  await db.ref(`users/${userId}`).set({ name, pin, role:'client', status:'active' });
  await db.ref(`balances/${userId}`).set({ personal: opening, staging: 0 });
  await appendLedger({
    userId,
    type:'client_created',
    title:'Client created',
    amount: opening,
    description: `${name} account created${opening ? ` with opening deposit ${money(opening)}` : ''}.`
  });

  modals.client.hide();
  els.newClientUsername.value = '';
  els.newClientName.value = '';
  els.newClientPin.value = '';
  els.newClientOpening.value = '0';
  showToast(`${name} was created successfully.`, 'success');
}

async function recordBill(){
  const userId = sanitizeUserId(els.billUser.value);
  const name = String(els.billName.value || '').trim();
  const amount = parseAmount(els.billAmount.value);
  const dueDate = String(els.billDueDate.value || '').trim();

  if (!userId || !name || Number.isNaN(amount) || amount <= 0) return showToast('Provide a client, bill name, and valid amount.', 'warning');

  const billId = uid('bill');
  await db.ref(`bills/${billId}`).set({
    userId,
    name,
    amount,
    dueDate,
    status:'open',
    createdAt: nowIso(),
                                      paidAt: null
  });
  await appendLedger({
    userId,
    billId,
    type:'bill_created',
    title:'Bill recorded',
    amount,
    description: `${name}${dueDate ? ` due ${dueDate}` : ''}.`
  });

  modals.bill.hide();
  els.billName.value = '';
  els.billAmount.value = '';
  els.billDueDate.value = '';
  showToast(`${name} was added for ${getUser(userId)?.name || userId}.`, 'success');
}

// NEW: The bill splitting logic
async function splitBill(){
  const billId = els.splitBillSelect.value;
  const originalBill = state.bills[billId];
  if (!originalBill || originalBill.status !== 'open') return showToast('Select a valid open bill.', 'warning');

  const clients = Object.entries(state.users).filter(([_, u]) => u.role === 'client');
  if (!clients.length) return showToast('No clients to split the bill with.', 'warning');

  const splitAmount = parseAmount(originalBill.amount / clients.length);
  if (splitAmount <= 0) return showToast('Amount too small to split.', 'warning');

  const writes = [];
  const timestamp = nowIso();

  // Close original master bill
  writes.push(db.ref(`bills/${billId}`).update({ status: 'split', splitAt: timestamp }));

  // Distribute it to all client accounts
  clients.forEach(([clientId, client]) => {
    const newBillId = uid('bill');
    writes.push(db.ref(`bills/${newBillId}`).set({
      userId: clientId,
      name: `${originalBill.name} (Split)`,
                                                 amount: splitAmount,
                                                 dueDate: originalBill.dueDate || '',
                                                 status: 'open',
                                                 createdAt: timestamp,
                                                 parentId: billId
    }));
    const ledgerId = uid('ledger');
    writes.push(db.ref(`ledger/${ledgerId}`).set({
      userId: clientId,
      billId: newBillId,
      type: 'bill_created',
      title: 'Split Bill Assigned',
      amount: splitAmount,
      description: `Your portion of ${originalBill.name}.`,
      createdAt: timestamp
    }));
  });

  await Promise.all(writes);
  modals.splitBill.hide();
  showToast(`Bill successfully split among ${clients.length} clients.`, 'success');
}

async function makeDeposit(userIdOverride=null){
  const userId = sanitizeUserId(userIdOverride || els.depositUser.value);
  const amount = parseAmount(els.depositAmount.value);
  const memo = String(els.depositMemo.value || '').trim();
  if (!userId || Number.isNaN(amount) || amount <= 0) return showToast('Select a client and enter a valid deposit amount.', 'warning');

  const result = await updateBalanceTransaction(userId, balance => ({ ...balance, personal: Number((balance.personal + amount).toFixed(2)) }));
  if (!result.committed) return showToast('Deposit could not be completed.', 'danger');

  await appendLedger({
    userId,
    type:'deposit',
    title:'Deposit posted',
    amount,
    description: memo || 'Admin deposit to checking.'
  });

  modals.deposit.hide();
  els.depositAmount.value = '';
  els.depositMemo.value = '';
  showToast(`Deposit posted to ${getUser(userId)?.name || userId}.`, 'success');
}

async function transferFunds(){
  const userId = state.currentUser;
  const direction = els.transferDirection.value;
  const amount = parseAmount(els.transferAmount.value);
  if (Number.isNaN(amount) || amount <= 0) return showToast('Enter a valid transfer amount.', 'warning');

  let failed = null;
  const result = await updateBalanceTransaction(userId, balance => {
    const next = { ...balance };
    if (direction === 'personal_to_staging') {
      if (next.personal < amount) { failed = 'Insufficient checking funds.'; return; }
      next.personal = Number((next.personal - amount).toFixed(2));
      next.staging = Number((next.staging + amount).toFixed(2));
    } else {
      if (next.staging < amount) { failed = 'Insufficient staging funds.'; return; }
      next.staging = Number((next.staging - amount).toFixed(2));
      next.personal = Number((next.personal + amount).toFixed(2));
    }
    return next;
  });

  if (!result.committed || failed) return showToast(failed || 'Transfer failed.', 'danger');

  const description = direction === 'personal_to_staging'
  ? 'Funds moved from checking to staging.'
  : 'Funds moved from staging to checking.';
  await appendLedger({ userId, type:'transfer', title:'Funds transferred', amount, description });
  modals.transfer.hide();
  els.transferAmount.value = '';
  showToast('Transfer completed.', 'success');
}

async function payBill(billIdOverride=null, userIdOverride=null){
  const billId = billIdOverride || els.payBillSelect.value;
  const bill = state.bills[billId];
  const userId = userIdOverride || state.currentUser;
  if (!bill || bill.status === 'paid' || bill.status === 'split') return showToast('Select an open bill.', 'warning');
  const amount = Number(bill.amount || 0);
  let failed = null;

  const result = await updateBalanceTransaction(userId, balance => {
    const next = { ...balance };
    if (next.staging < amount) { failed = 'Not enough staging funds to pay this bill.'; return; }
    next.staging = Number((next.staging - amount).toFixed(2));
    return next;
  });

  if (!result.committed || failed) return showToast(failed || 'Bill payment failed.', 'danger');

  await db.ref(`bills/${billId}`).update({ status:'paid', paidAt: nowIso() });
  await appendLedger({
    userId,
    billId,
    type:'bill_paid',
    title:'Bill paid',
    amount,
    description: `${bill.name} paid from staging.`
  });

  if (modals.payBill) modals.payBill.hide();
  showToast(`${bill.name} was paid successfully.`, 'success');
}

function openDepositModal(prefillUserId=''){
  populateClientSelect('deposit-user', { placeholder:'Select client' });
  els.depositUser.value = prefillUserId;
  els.depositAmount.value = '';
  els.depositMemo.value = '';
  modals.deposit.show();
}

function openBillModal(prefillUserId=''){
  populateClientSelect('bill-user', { placeholder:'Select client' });
  els.billUser.value = prefillUserId || (getUser(state.currentUser)?.role === 'client' ? state.currentUser : '');
  modals.bill.show();
}

function openPayBillModal(){
  populatePayBillSelect();
  modals.payBill.show();
}

function wireEventListeners(){
  els.loginBtn.addEventListener('click', authenticateUser);
  els.loginUser.addEventListener('keydown', e => { if (e.key === 'Enter') authenticateUser(); });
  els.loginPin.addEventListener('keydown', e => { if (e.key === 'Enter') authenticateUser(); });
  els.logoutBtn.addEventListener('click', logoutUser);

  els.openCreateClientModal.addEventListener('click', () => modals.client.show());
  els.openCreateBillModalAdmin.addEventListener('click', () => openBillModal());
  els.openCreateBillModalClient.addEventListener('click', () => openBillModal(state.currentUser));
  els.openTransferModal.addEventListener('click', () => modals.transfer.show());
  els.openDepositModal.addEventListener('click', () => openDepositModal());
  els.openPayBillModal.addEventListener('click', openPayBillModal);

  // NEW: Wire up the Split Bill modal
  els.openSplitBillModal.addEventListener('click', () => {
    populateSplitBillSelect();
    modals.splitBill.show();
  });

  els.saveClientBtn.addEventListener('click', () => createClient().catch(handleError));
  els.saveBillBtn.addEventListener('click', () => recordBill().catch(handleError));

  // NEW: Wire up the Split Bill execute button
  els.confirmSplitBillBtn.addEventListener('click', () => splitBill().catch(handleError));

  els.saveTransferBtn.addEventListener('click', () => transferFunds().catch(handleError));
  els.saveDepositBtn.addEventListener('click', () => makeDeposit().catch(handleError));
  els.confirmPayBillBtn.addEventListener('click', () => payBill().catch(handleError));

  document.addEventListener('click', event => {
    const tile = event.target.closest('.tile');
    if (tile) {
      const kind = tile.dataset.openWindow;
      if (kind) openWindow(kind);
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    const userId = actionButton.dataset.user;
    if (action === 'open-overview') openWindow('client_overview', userId);
    if (action === 'deposit') openDepositModal(userId);
    if (action === 'pay-next') {
      const nextBill = getOpenBillsForUser(userId).sort((a,b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0))[0];
      if (!nextBill) return showToast('This client has no open bills.', 'info');
      payBill(nextBill.id, userId).catch(handleError);
    }
  });
}

function handleError(error){
  console.error(error);
  showToast(error?.message || 'Something went wrong.', 'danger');
}

function cacheElements(){
  Object.assign(els, {
    loginWrapper: qs('login-wrapper'),
                appWrapper: qs('app-wrapper'),
                loginUser: qs('login-user'),
                loginPin: qs('login-pin'),
                loginBtn: qs('login-btn'),
                loginErr: qs('login-err'),
                sessionUserLabel: qs('session-user-label'),
                clockTime: qs('clockTime'),
                logoutBtn: qs('logout-btn'),
                clientWelcomeName: qs('client-welcome-name'),
                adminTotalCash: qs('admin-total-cash'),
                adminTotalStaging: qs('admin-total-staging'),
                adminOpenBillsTotal: qs('admin-open-bills-total'),
                adminUsersBody: qs('adminUsersBody'),
                dashPersonalBal: qs('dash-personal-bal'),
                dashStagingBal: qs('dash-staging-bal'),
                clientTotalDue: qs('client-total-due'),
                openCreateClientModal: qs('open-create-client-modal'),
                openCreateBillModalAdmin: qs('open-create-bill-modal-admin'),
                openCreateBillModalClient: qs('open-create-bill-modal-client'),
                openTransferModal: qs('open-transfer-modal'),
                openDepositModal: qs('open-deposit-modal'),
                openPayBillModal: qs('open-pay-bill-modal'),
                openSplitBillModal: qs('open-split-bill-modal'), // NEW
                newClientUsername: qs('new-client-username'),
                newClientName: qs('new-client-name'),
                newClientPin: qs('new-client-pin'),
                newClientOpening: qs('new-client-opening'),
                saveClientBtn: qs('save-client-btn'),
                billUser: qs('bill-user'),
                billName: qs('bill-name'),
                billAmount: qs('bill-amount'),
                billDueDate: qs('bill-due-date'),
                saveBillBtn: qs('save-bill-btn'),
                splitBillSelect: qs('split-bill-select'), // NEW
                confirmSplitBillBtn: qs('confirm-split-bill-btn'), // NEW
                transferDirection: qs('transfer-direction'),
                transferAmount: qs('transfer-amount'),
                saveTransferBtn: qs('save-transfer-btn'),
                depositUser: qs('deposit-user'),
                depositAmount: qs('deposit-amount'),
                depositMemo: qs('deposit-memo'),
                saveDepositBtn: qs('save-deposit-btn'),
                payBillSelect: qs('pay-bill-select'),
                confirmPayBillBtn: qs('confirm-pay-bill-btn')
  });
}

function initModals(){
  modals = {
    client: new bootstrap.Modal(qs('clientModal')),
    bill: new bootstrap.Modal(qs('billModal')),
    splitBill: new bootstrap.Modal(qs('splitBillModal')), // NEW
    transfer: new bootstrap.Modal(qs('transferModal')),
    deposit: new bootstrap.Modal(qs('depositModal')),
    payBill: new bootstrap.Modal(qs('payBillModal'))
  };
}

async function init(){
  cacheElements();
  initModals();
  wireEventListeners();
  await ensureAdminBootstrap();
  attachRealtimeListeners();
}

init().catch(handleError);

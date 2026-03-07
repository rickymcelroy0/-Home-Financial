const firebaseConfig = {
  databaseURL: 'https://homefund-3b81a-default-rtdb.firebaseio.com/',
  projectId: 'homefund-3b81a',
  authDomain: 'homefund-3b81a.firebaseapp.com',
  storageBucket: 'homefund-3b81a.appspot.com'
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const ADMIN_USER = 'admin';
const ADMIN_PIN = '0000';
const SESSION_KEY = 'hfc_session_v3';

let currentUser = null;
let users = {};
let balances = {};
let bills = {};
let privateBills = {};
let ledger = {};
let system = { treasury: { reserve: 0 } };

let clientModal, billModal, privateBillModal, transferModal, treasuryFundModal;

const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0));
const number = (n) => Number(Number(n || 0).toFixed(2));
const nowIso = () => new Date().toISOString();
const sortNewest = (arr) => [...arr].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

const openBillsForUser = (uid) => Object.entries(bills).filter(([_, b]) => b.userId === uid && b.status === 'open');
const paidBillsForUser = (uid) => Object.entries(bills).filter(([_, b]) => b.userId === uid && b.status === 'paid');
const getPrivateBillMap = (uid) => privateBills[uid] || {};
const openPrivateBillsForUser = (uid) => Object.entries(getPrivateBillMap(uid)).filter(([_, b]) => b.status === 'open');
const paidPrivateBillsForUser = (uid) => Object.entries(getPrivateBillMap(uid)).filter(([_, b]) => b.status === 'paid');
const ledgerItemsForUser = (uid) => sortNewest(Object.values(ledger).filter((x) => x.userId === uid));
const activeClientEntries = () => Object.entries(users).filter(([uid, u]) => uid !== ADMIN_USER && u.role === 'client');

function showToast(msg, type = 'info') {
  const container = $('toast-container');
  const toast = document.createElement('div');
  const map = { success: 'success', danger: 'danger', warning: 'warning', info: 'primary' };
  toast.className = `alert alert-${map[type] || 'primary'} shadow-sm border-0 mb-2`;
  toast.style.borderRadius = '18px';
  toast.innerHTML = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3400);
}

function showLoginError(msg) {
  const err = $('login-err');
  err.textContent = msg;
  err.classList.remove('d-none');
}

function clearLoginError() { $('login-err').classList.add('d-none'); }
function isAdmin() { return currentUser && users[currentUser]?.role === 'admin'; }

function ensureAdminBootstrap() {
  const updates = {};
  if (!users[ADMIN_USER]) {
    updates['users/admin'] = {
      username: 'admin',
      name: 'System Administrator',
      pin: ADMIN_PIN,
      role: 'admin',
      status: 'active',
      accountNumber: 'TRSY-000001',
      createdAt: nowIso()
    };
  }
  if (!balances[ADMIN_USER]) updates['balances/admin'] = { personal: 0, staging: 0 };
  if (system?.treasury?.reserve == null) updates['system/treasury/reserve'] = 0;
  if (Object.keys(updates).length) db.ref().update(updates);
}

function generateAccountNumber() {
  const existing = new Set(Object.values(users).map((u) => u.accountNumber).filter(Boolean));
  let candidate = '';
  do candidate = `HFC-${Math.floor(10000000 + Math.random() * 90000000)}`;
  while (existing.has(candidate));
  return candidate;
}

function setSession(uid) { localStorage.setItem(SESSION_KEY, uid); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

function authenticateUser() {
  const rawUser = $('login-user').value.trim().toLowerCase();
  const pin = $('login-pin').value.trim();
  if (!rawUser || !pin) return showLoginError('Enter a username and PIN.');

  const user = users[rawUser];
  const valid = user && user.pin === pin && user.status === 'active';
  const adminBootstrap = rawUser === ADMIN_USER && pin === ADMIN_PIN;
  if (!valid && !adminBootstrap) return showLoginError('Authentication failed.');

  currentUser = rawUser;
  setSession(rawUser);
  clearLoginError();

  $('login-pin').value = '';
  $('login-wrapper').classList.add('d-none');
  $('login-wrapper').classList.remove('d-flex');
  $('app-wrapper').classList.remove('d-none');

  renderAll();
  startClock();
  showToast(`Session established for <strong>${rawUser}</strong>.`, 'success');
}

function logoutUser() {
  currentUser = null;
  clearSession();

  $('app-wrapper').classList.add('d-none');
  $('login-wrapper').classList.remove('d-none');
  $('login-wrapper').classList.add('d-flex');

  $('login-user').value = '';
  $('login-pin').value = '';
}

function startClock() {
  if (window.__hfcClockStarted) return;
  window.__hfcClockStarted = true;
  setInterval(() => { $('clockTime').textContent = new Date().toLocaleTimeString([], { hour12: false }); }, 1000);
}

function renderView() {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  if (!currentUser) return;
  $('session-user-label').textContent = `${users[currentUser]?.name || currentUser} · ${users[currentUser]?.role || ''}`;

  // NEW: Show DB Button for Admin, hide for Client
  if (isAdmin()) {
    $('view-admin').classList.add('active');
    $('admin-db-link')?.classList.remove('d-none');
  } else {
    $('view-client').classList.add('active');
    $('admin-db-link')?.classList.add('d-none');
  }
}

function ledgerRowHTML(item) {
  return `<div class="list-row"><div><div class="fw-semibold">${item.title || 'Activity'}</div><div class="small muted">${item.description || ''}</div></div><div class="text-end"><div class="fw-semibold">${item.amount != null ? money(item.amount) : ''}</div><div class="small muted">${new Date(item.createdAt || Date.now()).toLocaleString()}</div></div></div>`;
}

function sharedBillRowHTML([billId, bill], includePay = false) {
  const user = users[bill.userId] || {};
  const canPay = includePay && bill.status === 'open';
  return `<div class="list-row">
  <div>
  <div class="fw-semibold">${bill.name}</div>
  <div class="small muted">${user.name || bill.userId} · due ${bill.dueDate || '—'} · ${bill.status}</div>
  </div>
  <div class="text-end">
  <div class="fw-semibold">${money(bill.amount)}</div>
  ${canPay ? `<button class="btn btn-sm btn-primary mt-2" onclick="payBill('${billId}')">Pay From Bill Vault</button>` : ''}
  </div>
  </div>`;
}

function privateBillRowHTML([billId, bill], includePay = false) {
  const canPay = includePay && bill.status === 'open';
  return `<div class="list-row">
  <div>
  <div class="fw-semibold">${bill.name}</div>
  <div class="small muted">${bill.category || 'Personal'} · due ${bill.dueDate || '—'} · ${bill.status}</div>
  </div>
  <div class="text-end">
  <div class="fw-semibold">${money(bill.amount)}</div>
  ${canPay ? `<button class="btn btn-sm btn-success mt-2" onclick="payPrivateBill('${billId}')">Pay From Bill Vault</button>` : ''}
  </div>
  </div>`;
}

function populateUserSelects() {
  const options = activeClientEntries().map(([uid, u]) => `<option value="${uid}">${u.name} (${uid})</option>`).join('');
  $('bill-user').innerHTML = options;
  $('treasury-user').innerHTML = options;
}

function coverageText(userId) {
  const userBals = balances[userId] || { staging: 0 };
  const sharedDue = openBillsForUser(userId).reduce((s, [_, b]) => s + number(b.amount), 0);
  const privateDue = openPrivateBillsForUser(userId).reduce((s, [_, b]) => s + number(b.amount), 0);
  return money(number(userBals.staging) - (sharedDue + privateDue));
}

function renderAdmin() {
  const treasuryReserve = number(system?.treasury?.reserve);
  const checkingTotal = Object.entries(balances).filter(([uid]) => uid !== ADMIN_USER).reduce((sum, [_, b]) => sum + number(b.personal), 0);
  const stagingTotal = Object.entries(balances).filter(([uid]) => uid !== ADMIN_USER).reduce((sum, [_, b]) => sum + number(b.staging), 0);
  const openTotal = Object.values(bills).filter((b) => b.status === 'open').reduce((sum, b) => sum + number(b.amount), 0);

  $('treasury-balance').textContent = money(treasuryReserve);
  $('admin-total-cash').textContent = money(checkingTotal);
  $('admin-total-staging').textContent = money(stagingTotal);
  $('admin-open-bills-total').textContent = money(openTotal);

  $('adminUsersBody').innerHTML = activeClientEntries().map(([uid, u]) => {
    const b = balances[uid] || { personal: 0, staging: 0 };
    return `<tr>
    <td><div class="fw-semibold">${u.name}</div><div class="small muted mono">${uid} · ${u.accountNumber || 'pending'}</div></td>
    <td>${money(b.personal)}</td>
    <td>${money(b.staging)}</td>
    <td><span class="pill ${u.status === 'active' ? 'status-active' : 'status-closed'}">${u.status}</span></td>
    <td>
    <div class="d-flex flex-wrap gap-2">
    <button class="btn btn-sm btn-outline-primary" onclick="openAccountWindow('client_overview','${uid}')">Open</button>
    <button class="btn btn-sm btn-outline-secondary" onclick="toggleUserStatus('${uid}')">${u.status === 'active' ? 'Close' : 'Open'}</button>
    <button class="btn btn-sm btn-outline-danger" onclick="deleteUser('${uid}')">Delete</button>
    </div>
    </td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" class="muted">No client accounts yet.</td></tr>`;

  const publicLedger = Object.values(ledger).filter(x => x.type !== 'private_bill_created' && x.type !== 'private_bill_paid');
  $('admin-ledger-feed').innerHTML = sortNewest(publicLedger).slice(0, 10).map(ledgerRowHTML).join('') || `<div class="muted">No activity yet.</div>`;

  $('bill-control-feed').innerHTML = sortNewest(Object.entries(bills).filter(([_, b]) => b.status === 'open').map(([id, b]) => ({ id, ...b })))
  .slice(0, 8)
  .map((b) => sharedBillRowHTML([b.id, b], true))
  .join('') || `<div class="muted">No shared bills.</div>`;
}

function renderClient() {
  const user = users[currentUser] || {};
  const userBals = balances[currentUser] || { personal: 0, staging: 0 };
  const sharedOpen = openBillsForUser(currentUser);
  const privateOpen = openPrivateBillsForUser(currentUser);
  const sharedDue = sharedOpen.reduce((sum, [_, bill]) => sum + number(bill.amount), 0);
  const privateDue = privateOpen.reduce((sum, [_, bill]) => sum + number(bill.amount), 0);
  const recommended = number(sharedDue + privateDue);
  const shortage = number(recommended - number(userBals.staging));

  $('client-welcome-name').textContent = `Welcome, ${user.name || currentUser}`;
  $('dash-personal-bal').textContent = money(userBals.personal);
  $('dash-staging-bal').textContent = money(userBals.staging);
  $('client-total-due').textContent = money(sharedDue);
  $('client-private-due').textContent = money(privateDue);
  $('coverage-pill').textContent = coverageText(currentUser);

  $('client-ledger-feed').innerHTML = ledgerItemsForUser(currentUser).slice(0, 12).map(ledgerRowHTML).join('') || `<div class="muted">No activity yet.</div>`;
  $('client-bill-feed').innerHTML = sharedOpen.map((entry) => sharedBillRowHTML(entry, true)).join('') || `<div class="muted">No shared bills.</div>`;
  $('private-bill-feed').innerHTML = privateOpen.map((entry) => privateBillRowHTML(entry, true)).join('') || `<div class="muted">No private bills yet.</div>`;

  $('money-guide').innerHTML = `
  <div class="mb-2"><strong>Suggested bill vault target:</strong> ${money(recommended)}</div>
  <div class="mb-2"><strong>Shared bills:</strong> ${money(sharedDue)}</div>
  <div class="mb-2"><strong>Private bills:</strong> ${money(privateDue)}</div>
  <div><strong>${shortage > 0 ? 'You still need to move' : 'You are ahead by'}</strong> ${money(Math.abs(shortage))} ${shortage > 0 ? 'into your bill vault.' : 'in your bill vault.'}</div>`;
}

function renderAll() {
  ensureAdminBootstrap();
  renderView();
  populateUserSelects();
  if (!currentUser) return;
  if (isAdmin()) renderAdmin();
  else renderClient();
}

function openAccountWindow(kind, uid = currentUser) {
  window.open(`account.html?kind=${encodeURIComponent(kind)}&user=${encodeURIComponent(uid)}`, '_blank', 'width=1160,height=840,resizable=yes');
}
window.openAccountWindow = openAccountWindow;

function createLedgerEntry(entry) {
  return db.ref('ledger').push({ createdAt: nowIso(), ...entry });
}

async function createClient() {
  const username = $('new-client-username').value.trim().toLowerCase();
  const name = $('new-client-name').value.trim();
  const pin = $('new-client-pin').value.trim();
  const opening = number($('new-client-opening').value);
  if (!username || !name || !pin) return showToast('Complete every client field.', 'warning');
  if (users[username]) return showToast('That username already exists.', 'danger');
  const accountNumber = generateAccountNumber();
  await db.ref().update({
    [`users/${username}`]: { username, name, pin, role: 'client', status: 'active', accountNumber, createdAt: nowIso() },
                        [`balances/${username}`]: { personal: 0, staging: 0 },
                        [`privateBills/${username}`]: null
  });
  await createLedgerEntry({ type: 'client_created', userId: username, amount: 0, title: 'Client created', description: `${name} created with account ${accountNumber}.` });
  if (opening > 0) await transferFromTreasury(username, 'personal', opening, 'Opening deposit');

  clientModal.hide();
  ['new-client-username', 'new-client-name', 'new-client-pin', 'new-client-opening'].forEach((id) => $(id).value = id === 'new-client-opening' ? '0' : '');
  showToast('Client account created.', 'success');
}

async function toggleUserStatus(uid) {
  const user = users[uid];
  if (!user) return;
  const newStatus = user.status === 'active' ? 'closed' : 'active';
  await db.ref(`users/${uid}/status`).set(newStatus);
  await createLedgerEntry({ type: 'user_status_changed', userId: uid, title: `User ${newStatus}`, description: `${users[currentUser]?.name || currentUser} changed ${uid} to ${newStatus}.` });
  showToast(`User ${newStatus}.`, 'success');
}
window.toggleUserStatus = toggleUserStatus;

async function deleteUser(uid) {
  if (!confirm(`Delete ${uid}? This removes the user, balances, and bill records.`)) return;
  const batch = { [`users/${uid}`]: null, [`balances/${uid}`]: null, [`privateBills/${uid}`]: null };
  Object.entries(bills).forEach(([billId, bill]) => { if (bill.userId === uid) batch[`bills/${billId}`] = null; });
  await db.ref().update(batch);
  await createLedgerEntry({ type: 'user_deleted', userId: uid, title: 'User deleted', description: `${users[currentUser]?.name || currentUser} deleted ${uid}.` });
  showToast('User deleted.', 'warning');
}
window.deleteUser = deleteUser;

async function fundTreasury() {
  const amount = number($('treasury-fund-amount').value);
  const memo = $('treasury-fund-note').value.trim() || 'Treasury funded';
  if (amount <= 0) return showToast('Enter an amount to fund treasury.', 'warning');
  await db.ref('system/treasury/reserve').transaction((cur) => number(cur) + amount);
  await createLedgerEntry({ type: 'treasury_funded', userId: ADMIN_USER, amount, title: 'Treasury funded', description: memo });
  treasuryFundModal.hide();
  $('treasury-fund-amount').value = '';
  $('treasury-fund-note').value = '';
  showToast('Treasury reserve increased.', 'success');
}

async function transferFromTreasury(uid, destination, amount, memo) {
  amount = number(amount);
  if (!uid || amount <= 0) return showToast('Choose a user and valid amount.', 'warning');
  const reserveResult = await db.ref('system/treasury/reserve').transaction((cur) => {
    cur = number(cur);
    if (cur < amount) return;
    return number(cur - amount);
  });
  if (!reserveResult.committed) return showToast('Treasury reserve is too low.', 'danger');

  await db.ref(`balances/${uid}/${destination}`).transaction((cur) => number(cur) + amount);
  await createLedgerEntry({
    type: 'treasury_transfer',
    userId: uid,
    amount,
    title: 'Treasury transfer',
    description: `${users[currentUser]?.name || currentUser} transferred ${money(amount)} from treasury into ${destination === 'staging' ? 'bill vault' : destination} for ${users[uid]?.name || uid}. ${memo || ''}`.trim()
  });
  showToast('Treasury transfer complete.', 'success');
}

async function executeTreasuryTransfer() {
  await transferFromTreasury($('treasury-user').value, $('treasury-destination').value, $('treasury-amount').value, $('treasury-note').value.trim());
  $('treasury-amount').value = '';
  $('treasury-note').value = '';
}

async function createSharedBill() {
  const userId = isAdmin() ? $('bill-user').value : currentUser;
  const name = $('bill-name').value.trim();
  const amount = number($('bill-amount').value);
  const dueDate = $('bill-due-date').value;
  if (!userId || !name || amount <= 0) return showToast('Enter a client, bill name, and amount.', 'warning');
  const ref = db.ref('bills').push();
  await ref.set({ userId, name, amount, dueDate: dueDate || '', status: 'open', createdAt: nowIso(), createdBy: currentUser });
  await createLedgerEntry({ type: 'bill_created', userId, amount, title: 'Shared bill recorded', description: `${name} was recorded${dueDate ? ` with due date ${dueDate}` : ''}.` });
  billModal.hide();
  ['bill-name', 'bill-amount', 'bill-due-date'].forEach((id) => $(id).value = '');
  showToast('Shared bill recorded.', 'success');
}

async function createPrivateBill() {
  const name = $('private-bill-name').value.trim();
  const amount = number($('private-bill-amount').value);
  const dueDate = $('private-bill-due-date').value;
  const category = $('private-bill-category').value.trim();
  if (!name || amount <= 0) return showToast('Enter a bill name and amount.', 'warning');
  const ref = db.ref(`privateBills/${currentUser}`).push();
  await ref.set({ name, amount, dueDate: dueDate || '', category: category || 'Personal', status: 'open', createdAt: nowIso() });
  await createLedgerEntry({ type: 'private_bill_created', userId: currentUser, amount, title: 'Private bill added', description: `${name} added to your private planner.` });
  privateBillModal.hide();
  ['private-bill-name', 'private-bill-amount', 'private-bill-due-date', 'private-bill-category'].forEach((id) => $(id).value = '');
  showToast('Private bill added to your planner.', 'success');
}

async function transferBetweenClientBalances() {
  const direction = $('transfer-direction').value;
  const amount = number($('transfer-amount').value);
  const note = $('transfer-note').value.trim() || 'Balance transfer';
  if (amount <= 0) return showToast('Enter a valid transfer amount.', 'warning');

  const fromKey = direction === 'personal_to_staging' ? 'personal' : 'staging';
  const toKey = direction === 'personal_to_staging' ? 'staging' : 'personal';
  const debit = await db.ref(`balances/${currentUser}/${fromKey}`).transaction((cur) => {
    cur = number(cur);
    if (cur < amount) return;
    return number(cur - amount);
  });
  if (!debit.committed) return showToast('Insufficient funds for transfer.', 'danger');

  await db.ref(`balances/${currentUser}/${toKey}`).transaction((cur) => number(cur) + amount);
  await createLedgerEntry({ type: 'transfer', userId: currentUser, amount, title: 'Internal transfer', description: `${money(amount)} moved from ${fromKey === 'personal' ? 'checking' : 'bill vault'} to ${toKey === 'personal' ? 'checking' : 'bill vault'}. ${note}` });
  transferModal.hide();
  $('transfer-amount').value = '';
  $('transfer-note').value = '';
  showToast('Transfer complete.', 'success');
}

async function debitBillVault(uid, amount) {
  const result = await db.ref(`balances/${uid}/staging`).transaction((cur) => {
    cur = number(cur);
    if (cur < amount) return;
    return number(cur - amount);
  });
  return result.committed;
}

async function payBill(billId) {
  const bill = bills[billId];
  if (!bill || bill.status !== 'open') return showToast('This bill is no longer open.', 'warning');
  if (!isAdmin() && bill.userId !== currentUser) return showToast('You cannot pay this bill.', 'danger');

  const amount = number(bill.amount);
  const committed = await debitBillVault(bill.userId, amount);
  if (!committed) return showToast('Not enough money in the bill vault.', 'danger');
  await db.ref(`bills/${billId}`).update({ status: 'paid', paidAt: nowIso(), paidBy: currentUser });
  await createLedgerEntry({ type: 'bill_paid', userId: bill.userId, amount, title: 'Shared bill paid', description: `${bill.name} paid from bill vault by ${users[currentUser]?.name || currentUser}.` });
  showToast('Shared bill paid and recorded in ledger.', 'success');
}
window.payBill = payBill;

async function payPrivateBill(billId) {
  const bill = getPrivateBillMap(currentUser)[billId];
  if (!bill || bill.status !== 'open') return showToast('This private bill is no longer open.', 'warning');
  const amount = number(bill.amount);
  const committed = await debitBillVault(currentUser, amount);
  if (!committed) return showToast('Not enough money in the bill vault.', 'danger');
  await db.ref(`privateBills/${currentUser}/${billId}`).update({ status: 'paid', paidAt: nowIso() });
  await createLedgerEntry({ type: 'private_bill_paid', userId: currentUser, amount, title: 'Private bill paid', description: `${bill.name} paid from your bill vault.` });
  showToast('Private bill paid from bill vault.', 'success');
}
window.payPrivateBill = payPrivateBill;

function bindEvents() {
  $('login-btn').addEventListener('click', authenticateUser);
  $('logout-btn').addEventListener('click', logoutUser);
  $('login-pin').addEventListener('keydown', (e) => e.key === 'Enter' && authenticateUser());
  $('open-create-client-modal').addEventListener('click', () => clientModal.show());
  $('open-create-bill-modal-admin').addEventListener('click', () => { $('bill-user').value = $('bill-user').value || activeClientEntries()[0]?.[0] || ''; billModal.show(); });
  $('open-create-bill-modal-client').addEventListener('click', () => billModal.show());
  $('open-private-bill-modal').addEventListener('click', () => privateBillModal.show());
  $('open-transfer-modal').addEventListener('click', () => transferModal.show());
  $('open-treasury-fund-modal').addEventListener('click', () => treasuryFundModal.show());
  $('save-client-btn').addEventListener('click', createClient);
  $('save-bill-btn').addEventListener('click', createSharedBill);
  $('save-private-bill-btn').addEventListener('click', createPrivateBill);
  $('save-transfer-btn').addEventListener('click', transferBetweenClientBalances);
  $('save-treasury-fund-btn').addEventListener('click', fundTreasury);
  $('execute-treasury-transfer').addEventListener('click', executeTreasuryTransfer);
  document.querySelectorAll('.tile').forEach((tile) => tile.addEventListener('click', () => openAccountWindow(tile.dataset.openWindow)));
}

function initModals() {
  clientModal = new bootstrap.Modal($('clientModal'));
  billModal = new bootstrap.Modal($('billModal'));
  privateBillModal = new bootstrap.Modal($('privateBillModal'));
  transferModal = new bootstrap.Modal($('transferModal'));
  treasuryFundModal = new bootstrap.Modal($('treasuryFundModal'));
}

function attemptSessionRestore() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved && users[saved]?.status === 'active') {
    currentUser = saved;
    $('login-wrapper').classList.add('d-none');
    $('login-wrapper').classList.remove('d-flex');
    $('app-wrapper').classList.remove('d-none');
  }
}

function subscribe() {
  db.ref('users').on('value', (snap) => { users = snap.val() || {}; ensureAdminBootstrap(); attemptSessionRestore(); renderAll(); });
  db.ref('balances').on('value', (snap) => { balances = snap.val() || {}; renderAll(); });
  db.ref('bills').on('value', (snap) => { bills = snap.val() || {}; renderAll(); });
  db.ref('privateBills').on('value', (snap) => { privateBills = snap.val() || {}; renderAll(); });
  db.ref('ledger').on('value', (snap) => { ledger = snap.val() || {}; renderAll(); });
  db.ref('system').on('value', (snap) => { system = snap.val() || { treasury: { reserve: 0 } }; renderAll(); });
}

initModals();
bindEvents();
subscribe();

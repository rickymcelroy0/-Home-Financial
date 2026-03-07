const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const admin = require('firebase-admin');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = String(process.env.BACKEND_ADMIN_PIN || '').trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || '').trim();
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';
const DATABASE_URL = String(process.env.FIREBASE_DATABASE_URL || '').trim();

if (!ADMIN_PIN) throw new Error('Missing BACKEND_ADMIN_PIN in environment.');
if (!SESSION_SECRET) throw new Error('Missing SESSION_SECRET in environment.');
if (!DATABASE_URL) throw new Error('Missing FIREBASE_DATABASE_URL in environment.');

function loadServiceAccount() {
  const encoded = String(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim();
  const filePath = String(process.env.FIREBASE_SERVICE_ACCOUNT_FILE || '').trim();

  if (encoded) {
    const json = Buffer.from(encoded, 'base64').toString('utf8');
    return JSON.parse(json);
  }

  if (filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  }

  throw new Error('Missing Firebase service account. Set FIREBASE_SERVICE_ACCOUNT_BASE64 or FIREBASE_SERVICE_ACCOUNT_FILE.');
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
    databaseURL: DATABASE_URL
  });
}

const db = admin.database();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(session({
  name: 'hfc_admin_session',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use('/admin', express.static(path.join(__dirname, 'public')));

function sendError(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

function requireAdmin(req, res, next) {
  if (!req.session || req.session.isAdmin !== true) {
    return sendError(res, 401, 'Unauthorized');
  }
  next();
}

function nowIso() {
  return new Date().toISOString();
}

function cleanPath(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/^\/+|\/+$/g, '');
  if (normalized.includes('..') || normalized.includes('//')) {
    throw new Error('Invalid database path');
  }
  return normalized;
}

function userRef(userId) {
  return db.ref(`users/${userId}`);
}

function balanceRef(userId) {
  return db.ref(`balances/${userId}`);
}

function billRef(billId) {
  return db.ref(`bills/${billId}`);
}

async function writeLedger(entry) {
  const payload = {
    createdAt: nowIso(),
    ...entry
  };
  const ref = db.ref('ledger').push();
  await ref.set(payload);
  return ref.key;
}

function generateAccountNumber(existingNumbers) {
  let candidate = '';
  do {
    const partA = String(Math.floor(1000 + Math.random() * 9000));
    const partB = String(Math.floor(1000 + Math.random() * 9000));
    const partC = String(Math.floor(100 + Math.random() * 900));
    candidate = `${partA}${partB}${partC}`;
  } while (existingNumbers.has(candidate));
  return candidate;
}

async function getAllUsers() {
  const snapshot = await db.ref('users').get();
  return snapshot.val() || {};
}

async function getAllBalances() {
  const snapshot = await db.ref('balances').get();
  return snapshot.val() || {};
}

async function getAllBills() {
  const snapshot = await db.ref('bills').get();
  return snapshot.val() || {};
}

async function getAllLedger() {
  const snapshot = await db.ref('ledger').get();
  return snapshot.val() || {};
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'hfc-admin-backend', time: nowIso() });
});

app.post('/api/login', (req, res) => {
  const pin = String(req.body?.pin || '').trim();
  if (pin !== ADMIN_PIN) {
    return sendError(res, 401, 'Invalid admin PIN');
  }
  req.session.isAdmin = true;
  req.session.loggedInAt = nowIso();
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('hfc_admin_session');
    res.json({ ok: true });
  });
});

app.get('/api/session', (req, res) => {
  res.json({ ok: true, authenticated: !!(req.session && req.session.isAdmin) });
});

app.get('/api/overview', requireAdmin, async (_req, res) => {
  const [users, balances, bills, ledger] = await Promise.all([
    getAllUsers(), getAllBalances(), getAllBills(), getAllLedger()
  ]);

  const userCount = Object.keys(users).length;
  const activeUsers = Object.values(users).filter((u) => (u.status || 'open') === 'open').length;
  const totalChecking = Object.values(balances).reduce((sum, b) => sum + Number(b?.personal || 0), 0);
  const totalVault = Object.values(balances).reduce((sum, b) => sum + Number(b?.staging || 0), 0);
  const openBills = Object.values(bills).filter((b) => b?.status === 'open');
  const openBillTotal = openBills.reduce((sum, b) => sum + Number(b?.amount || 0), 0);

  res.json({
    ok: true,
    summary: {
      userCount,
      activeUsers,
      totalChecking,
      totalVault,
      openBillCount: openBills.length,
      openBillTotal,
      ledgerCount: Object.keys(ledger).length
    },
    users,
    balances,
    bills,
    ledger
  });
});

app.get('/api/db', requireAdmin, async (req, res) => {
  try {
    const targetPath = cleanPath(req.query.path || '');
    const snapshot = targetPath ? await db.ref(targetPath).get() : await db.ref().get();
    res.json({ ok: true, path: targetPath || '/', value: snapshot.val() });
  } catch (error) {
    sendError(res, 400, error.message);
  }
});

app.put('/api/db', requireAdmin, async (req, res) => {
  try {
    const targetPath = cleanPath(req.body?.path || '');
    if (!targetPath) return sendError(res, 400, 'Path is required');
    await db.ref(targetPath).set(req.body?.value ?? null);
    await writeLedger({ type: 'db_write', title: 'Database write', description: `Path updated: ${targetPath}` });
    res.json({ ok: true });
  } catch (error) {
    sendError(res, 400, error.message);
  }
});

app.delete('/api/db', requireAdmin, async (req, res) => {
  try {
    const targetPath = cleanPath(req.query.path || '');
    if (!targetPath) return sendError(res, 400, 'Path is required');
    await db.ref(targetPath).remove();
    await writeLedger({ type: 'db_delete', title: 'Database delete', description: `Path removed: ${targetPath}` });
    res.json({ ok: true });
  } catch (error) {
    sendError(res, 400, error.message);
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim();
  const pin = String(req.body?.pin || '').trim();
  const openingChecking = Number(req.body?.openingChecking || 0);
  const openingVault = Number(req.body?.openingVault || 0);

  if (!username || !name || !pin) return sendError(res, 400, 'username, name, and pin are required');
  if (!Number.isFinite(openingChecking) || openingChecking < 0) return sendError(res, 400, 'Invalid opening checking amount');
  if (!Number.isFinite(openingVault) || openingVault < 0) return sendError(res, 400, 'Invalid opening vault amount');

  const existingUserSnap = await userRef(username).get();
  if (existingUserSnap.exists()) return sendError(res, 409, 'User already exists');

  const users = await getAllUsers();
  const existingNumbers = new Set(Object.values(users).map((u) => u?.accountNumber).filter(Boolean));
  const accountNumber = generateAccountNumber(existingNumbers);

  await userRef(username).set({
    username,
    name,
    pin,
    role: 'client',
    status: 'open',
    accountNumber,
    createdAt: nowIso()
  });

  await balanceRef(username).set({
    personal: openingChecking,
    staging: openingVault,
    updatedAt: nowIso()
  });

  await writeLedger({
    type: 'client_created',
    userId: username,
    title: 'Client account created',
    description: `${name} (${username}) created with account ${accountNumber}`,
    amount: openingChecking + openingVault
  });

  res.json({ ok: true, userId: username, accountNumber });
});

app.patch('/api/users/:userId/status', requireAdmin, async (req, res) => {
  const userId = String(req.params.userId || '').trim().toLowerCase();
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!['open', 'closed'].includes(status)) return sendError(res, 400, 'Status must be open or closed');

  const snap = await userRef(userId).get();
  if (!snap.exists()) return sendError(res, 404, 'User not found');

  await userRef(userId).update({ status, updatedAt: nowIso() });
  await writeLedger({ type: 'user_status', userId, title: 'User status changed', description: `User set to ${status}` });
  res.json({ ok: true });
});

app.delete('/api/users/:userId', requireAdmin, async (req, res) => {
  const userId = String(req.params.userId || '').trim().toLowerCase();
  const snap = await userRef(userId).get();
  if (!snap.exists()) return sendError(res, 404, 'User not found');

  const updates = {};
  updates[`users/${userId}`] = null;
  updates[`balances/${userId}`] = null;

  const bills = await getAllBills();
  Object.entries(bills).forEach(([billId, bill]) => {
    if (bill?.userId === userId) {
      updates[`bills/${billId}`] = null;
    }
  });

  await db.ref().update(updates);
  await writeLedger({ type: 'user_deleted', userId, title: 'User deleted', description: `User ${userId} and related records removed` });
  res.json({ ok: true });
});

app.post('/api/treasury/transfer', requireAdmin, async (req, res) => {
  const userId = String(req.body?.userId || '').trim().toLowerCase();
  const target = String(req.body?.target || '').trim().toLowerCase();
  const amount = Number(req.body?.amount || 0);
  const memo = String(req.body?.memo || '').trim();

  if (!userId || !['personal', 'staging'].includes(target)) return sendError(res, 400, 'userId and valid target are required');
  if (!Number.isFinite(amount) || amount <= 0) return sendError(res, 400, 'Amount must be greater than 0');

  const userSnap = await userRef(userId).get();
  if (!userSnap.exists()) return sendError(res, 404, 'User not found');

  await balanceRef(userId).child(target).transaction((current) => Number(current || 0) + amount);
  await balanceRef(userId).child('updatedAt').set(nowIso());

  await writeLedger({
    type: 'treasury_transfer',
    userId,
    title: 'Treasury transfer',
    description: `Treasury credited ${target}${memo ? ` · ${memo}` : ''}`,
    amount
  });

  res.json({ ok: true });
});

app.post('/api/transfers', requireAdmin, async (req, res) => {
  const userId = String(req.body?.userId || '').trim().toLowerCase();
  const direction = String(req.body?.direction || '').trim();
  const amount = Number(req.body?.amount || 0);

  if (!userId || !['personal_to_staging', 'staging_to_personal'].includes(direction)) {
    return sendError(res, 400, 'userId and valid direction are required');
  }
  if (!Number.isFinite(amount) || amount <= 0) return sendError(res, 400, 'Amount must be greater than 0');

  const snap = await balanceRef(userId).get();
  const current = snap.val() || { personal: 0, staging: 0 };
  const personal = Number(current.personal || 0);
  const staging = Number(current.staging || 0);

  if (direction === 'personal_to_staging' && personal < amount) return sendError(res, 400, 'Insufficient checking funds');
  if (direction === 'staging_to_personal' && staging < amount) return sendError(res, 400, 'Insufficient vault funds');

  const next = direction === 'personal_to_staging'
    ? { personal: personal - amount, staging: staging + amount }
    : { personal: personal + amount, staging: staging - amount };

  await balanceRef(userId).update({ ...next, updatedAt: nowIso() });
  await writeLedger({
    type: 'transfer',
    userId,
    title: 'Internal transfer',
    description: direction === 'personal_to_staging' ? 'Checking to vault' : 'Vault to checking',
    amount
  });

  res.json({ ok: true });
});

app.post('/api/bills', requireAdmin, async (req, res) => {
  const userId = String(req.body?.userId || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim();
  const amount = Number(req.body?.amount || 0);
  const dueDate = String(req.body?.dueDate || '').trim();
  const visibility = String(req.body?.visibility || 'shared').trim().toLowerCase();

  if (!userId || !name) return sendError(res, 400, 'userId and name are required');
  if (!Number.isFinite(amount) || amount <= 0) return sendError(res, 400, 'Amount must be greater than 0');
  if (!['shared', 'private'].includes(visibility)) return sendError(res, 400, 'visibility must be shared or private');

  const userSnap = await userRef(userId).get();
  if (!userSnap.exists()) return sendError(res, 404, 'User not found');

  const ref = db.ref(visibility === 'private' ? 'privateBills' : 'bills').push();
  await ref.set({
    userId,
    name,
    amount,
    dueDate,
    status: 'open',
    visibility,
    createdAt: nowIso()
  });

  await writeLedger({
    type: 'bill_created',
    userId,
    title: visibility === 'private' ? 'Private bill added' : 'Bill recorded',
    description: `${name} created`,
    amount
  });

  res.json({ ok: true, billId: ref.key });
});

app.post('/api/bills/:billId/pay', requireAdmin, async (req, res) => {
  const billId = String(req.params.billId || '').trim();
  const scope = String(req.body?.scope || 'shared').trim().toLowerCase();
  const collection = scope === 'private' ? 'privateBills' : 'bills';
  const snap = await db.ref(`${collection}/${billId}`).get();

  if (!snap.exists()) return sendError(res, 404, 'Bill not found');
  const bill = snap.val();
  if (bill.status === 'paid') return sendError(res, 400, 'Bill already paid');

  const balSnap = await balanceRef(bill.userId).get();
  const current = balSnap.val() || { personal: 0, staging: 0 };
  const staging = Number(current.staging || 0);
  const amount = Number(bill.amount || 0);
  if (staging < amount) return sendError(res, 400, 'Insufficient vault funds');

  await balanceRef(bill.userId).update({ staging: staging - amount, updatedAt: nowIso() });
  await db.ref(`${collection}/${billId}`).update({ status: 'paid', paidAt: nowIso() });

  await writeLedger({
    type: 'bill_paid',
    userId: bill.userId,
    title: 'Bill paid',
    description: `${bill.name} paid from vault`,
    amount
  });

  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  sendError(res, 500, 'Internal server error');
});

app.listen(PORT, () => {
  console.log(`HFC admin backend listening on http://localhost:${PORT}`);
});

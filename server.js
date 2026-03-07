import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  PORT = 3000,
  BACKEND_ADMIN_PIN,
  SESSION_SECRET,
  FIREBASE_DATABASE_URL,
  FIREBASE_SERVICE_ACCOUNT_BASE64
} = process.env;

if (!BACKEND_ADMIN_PIN || !SESSION_SECRET || !FIREBASE_DATABASE_URL || !FIREBASE_SERVICE_ACCOUNT_BASE64) {
  console.error('Missing required environment variables. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(Buffer.from(FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
} catch (error) {
  console.error('Could not decode FIREBASE_SERVICE_ACCOUNT_BASE64:', error.message);
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: FIREBASE_DATABASE_URL
  });
}

const db = admin.database();
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/static', express.static(path.join(__dirname, 'public')));

const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const FORBIDDEN_ROOTS = new Set(['.settings', '.info']);

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}
setInterval(cleanupSessions, 1000 * 60 * 15).unref();

function makeSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { expiresAt });
  return { token, expiresAt };
}

function requireAuth(req, res, next) {
  const token = req.cookies.hfc_admin_session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function normalizePath(rawPath = '') {
  let cleaned = String(rawPath || '').trim();
  cleaned = cleaned.replace(/^\/+|\/+$/g, '');
  const root = cleaned.split('/')[0];
  if (FORBIDDEN_ROOTS.has(root)) throw new Error('That path is not allowed.');
  return cleaned;
}

function dbRefForPath(rawPath) {
  const clean = normalizePath(rawPath);
  return clean ? db.ref(clean) : db.ref();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'hfc-admin-backend' });
});

app.post('/api/login', (req, res) => {
  const { pin } = req.body || {};
  if (!pin || pin !== BACKEND_ADMIN_PIN) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  const session = makeSession();
  res.cookie('hfc_admin_session', session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SESSION_TTL_MS
  });
  res.json({ ok: true });
});

app.post('/api/logout', requireAuth, (req, res) => {
  const token = req.cookies.hfc_admin_session;
  if (token) sessions.delete(token);
  res.clearCookie('hfc_admin_session');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (_req, res) => {
  res.json({ ok: true, role: 'admin_backend' });
});

app.get('/api/db', requireAuth, async (req, res) => {
  try {
    const path = req.query.path || '';
    const snapshot = await dbRefForPath(path).get();
    res.json({ ok: true, path: normalizePath(path), value: snapshot.val() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/db', requireAuth, async (req, res) => {
  try {
    const path = req.query.path || '';
    await dbRefForPath(path).set(req.body?.value ?? null);
    res.json({ ok: true, path: normalizePath(path) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/db', requireAuth, async (req, res) => {
  try {
    const path = req.query.path || '';
    const value = req.body?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return res.status(400).json({ error: 'PATCH requires an object in body.value' });
    }
    await dbRefForPath(path).update(value);
    res.json({ ok: true, path: normalizePath(path) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/db', requireAuth, async (req, res) => {
  try {
    const path = req.query.path || '';
    await dbRefForPath(path).remove();
    res.json({ ok: true, path: normalizePath(path) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/backend', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-db.html'));
});

app.listen(PORT, () => {
  console.log(`HFC admin backend running on http://localhost:${PORT}`);
});

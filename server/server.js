// Saigon Critters community server: `node server/server.js`.
// - Data: MongoDB when MONGODB_URI is set (production), JSON files in data/ otherwise (see storage.js).
//   The server keeps no data in memory between requests, so several instances can run at once
//   (Render's zero-downtime deploys do exactly that).
// - Serves the built web app from dist/ and the shelter admin page at /admin
// - API:
//   GET  /api/health, /healthz
//   GET  /api/sightings[?since=ms]  POST /api/sightings (upsert + per-field merge)
//   POST /api/auth/register         POST /api/auth/login         POST /api/auth/logout
//   POST /api/auth/recover          (username + recovery code → new password)
//   POST /api/me/progress           (sync XP, badges, quests; returns the account)
//   POST /api/shelter/apply
//   GET  /api/admin/users           POST /api/admin/users        GET /api/admin/ip   (X-Admin-Key)

import http from 'node:http';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream, statSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES_BY_ID } from '../src/species.js';
import { openStorage } from './storage.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || join(root, 'data');
const ADMIN_KEY_FILE = join(DATA, 'admin-key.txt');
const DIST = join(root, 'dist');
const ADMIN_PAGE = join(root, 'server', 'admin.html');
const PORT = +process.env.PORT || 8787;
const MAX_BODY = 6 * 1024 * 1024;

// Render wipes the disk on every deploy: never keep real data there by accident.
if (!process.env.MONGODB_URI && process.env.RENDER && !process.env.ALLOW_FILE_STORAGE) {
  console.error('❌ MONGODB_URI is not set. On Render, file storage would lose all data on the next deploy.\n'
    + '   Set MONGODB_URI (or ALLOW_FILE_STORAGE=1 for a throwaway test).');
  process.exit(1);
}

// If storage can't be reached the deploy should fail loudly (Render keeps the old version running).
const storage = await openStorage({
  dataDir: DATA,
  mongoUri: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB || 'saigon_critters',
  s3: {
    endpoint: process.env.PHOTOS_S3_ENDPOINT,
    region: process.env.PHOTOS_S3_REGION,
    bucket: process.env.PHOTOS_S3_BUCKET,
    keyId: process.env.PHOTOS_S3_KEY_ID,
    secret: process.env.PHOTOS_S3_SECRET,
  },
}).catch(e => {
  console.error(`❌ Storage is not available: ${e.message}`);
  process.exit(1);
});

// The admin key protects shelter approval. In production set ADMIN_KEY; for local files one
// is generated into data/admin-key.txt.
let ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY && storage.kind.startsWith('files')) {
  mkdirSync(DATA, { recursive: true });
  if (!existsSync(ADMIN_KEY_FILE)) writeFileSync(ADMIN_KEY_FILE, randomBytes(18).toString('base64url') + '\n', { mode: 0o600 });
  ADMIN_KEY = readFileSync(ADMIN_KEY_FILE, 'utf8').trim();
}

// ---------- helpers ----------

const sha = s => createHash('sha256').update(String(s)).digest('hex');
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = v => (Number.isFinite(+v) ? +v : 0);
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(num(v))));
const hash = key => (typeof key === 'string' && key.length >= 16 ? sha(key) : null);
// Client clocks can't push timestamps into the future and freeze a record.
const clampTime = (t, now) => Math.min(num(t) || now, now + 5 * 60e3);
const httpError = (status, message) => Object.assign(new Error(message), { status });
// Names are shown next to the verified-shelter badge, so they can't contain check-mark look-alikes.
const cleanName = (v, max) => str(v, max * 2).replace(/[✅☑✓✔\u{1F5F8}]/gu, '').trim().slice(0, max);

// Async scrypt runs on the libuv thread pool, so hashing never blocks other requests.
const scryptAsync = promisify(scrypt);
async function hashSecret(secret, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${(await scryptAsync(secret, salt, 64)).toString('hex')}`;
}
async function checkSecret(secret, stored) {
  if (typeof secret !== 'string' || typeof stored !== 'string') return false;
  const [salt, h] = stored.split(':');
  const want = Buffer.from(h, 'hex');
  const got = await scryptAsync(secret, salt, 64);
  return want.length === got.length && timingSafeEqual(want, got);
}
// Easy to read out loud or copy from a screenshot: XXXX-XXXX-XXXX-XXXX, no 0/O/1/I.
function newRecoveryCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  return Array.from({ length: 4 }, (_, g) => Array.from({ length: 4 }, (_, i) => abc[bytes[g * 4 + i] % abc.length]).join('')).join('-');
}
const normCode = c => (typeof c === 'string' ? c.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

const isShelter = u => u?.role === 'shelter' && u.shelter?.status === 'approved';
const displayName = u => (isShelter(u) ? u.shelter.name : u.profile.name || u.username);

const STAT_KEYS = ['catches', 'rated', 'helped', 'rescued', 'adoptions'];
const emptyStats = () => Object.fromEntries(STAT_KEYS.map(k => [k, 0]));

const publicUser = u => ({ id: u.id, username: u.username, role: u.role, shelter: u.shelter, profile: u.profile, profileAt: u.profileAt });

/** Read, change, write with a version check; on a conflict (another request or instance won) re-read and redo. */
async function mutate(get, update, id, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await get(id);
    if (!cur) throw httpError(404, 'Not found.');
    const next = structuredClone(cur);
    await fn(next);
    if (await update(next, cur.v || 0)) return next;
  }
  throw httpError(503, 'Busy, please try again.');
}
const mutateUser = (id, fn) => mutate(storage.getUserById, storage.updateUser, id, fn);
const mutateSighting = (id, fn) => mutate(storage.getSighting, storage.updateSighting, id, fn);

// Small brute-force brakes, one bucket per client and purpose. Behind a proxy, set TRUST_PROXY to the
// number of proxies in front of us: proxies append to X-Forwarded-For, so the client is that many from the right.
const attempts = new Map();
function ipOf(req) {
  const hops = parseInt(process.env.TRUST_PROXY || '0', 10);
  if (hops > 0) {
    const chain = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (chain.length >= hops) return chain[chain.length - hops];
  }
  return req.socket.remoteAddress || '?';
}
// Per 15 min (register: per hour). Generous because Vietnamese mobile carriers put many phones behind one IP.
const LIMITS = { login: 20, recover: 10, admin: 10, register: 30, upload: 600, photo: 120 };
function bucket(req, kind) {
  const key = `${kind}:${ipOf(req)}`, now = Date.now();
  let a = attempts.get(key);
  if (!a || a.until < now) {
    a = { count: 0, until: now + (kind === 'register' ? 60 : 15) * 60e3 };
    attempts.set(key, a);
  }
  return a;
}
function checkRate(req, kind) {
  if (bucket(req, kind).count >= LIMITS[kind]) throw httpError(429, 'Too many attempts. Please try again later.');
}
const failed = (req, kind) => { bucket(req, kind).count++; };
// Count the attempt before the (slow) password check so a burst of parallel guesses can't slip through;
// a successful attempt gives it back.
const attempt = (req, kind) => { checkRate(req, kind); failed(req, kind); };
const succeeded = (req, kind) => { const a = bucket(req, kind); a.count = Math.max(0, a.count - 1); };
setInterval(() => { const now = Date.now(); for (const [k, a] of attempts) if (a.until < now) attempts.delete(k); }, 10 * 60e3).unref();

// ---------- identity ----------

const BEARER = /^Bearer ([a-f0-9]{64})$/;

/**
 * Anonymous players are proved by their device key: the first upload from a player id registers
 * its key, later uploads must present the same one. Account holders sign in instead.
 */
async function proveAnon(actorId, key) {
  if (!/^u-[a-z0-9]{4,38}$/i.test(actorId) || !key) return false;
  if (await storage.getUserById(actorId)) return false; // that's an account: sign in
  const stored = await storage.getAnonKey(actorId);
  if (stored) return stored === key;
  if (await storage.setAnonKey(actorId, key)) return true;
  return (await storage.getAnonKey(actorId)) === key; // registered concurrently
}

/**
 * Hand everything an anonymous player did on this phone to the account: their sightings, their
 * ratings (keeping the newest if both rated) and their "on it"/"helped" marks. Needs the device key.
 * Idempotent, so it also runs on later syncs to pick up uploads that raced the sign-in.
 */
async function claimDevice(u, deviceId, deviceSecret) {
  const key = hash(deviceSecret);
  if (!key || typeof deviceId !== 'string' || deviceId === u.id) return 0;
  if ((await storage.getAnonKey(deviceId)) !== key) return 0;
  const ids = await storage.sightingIdsTouching(deviceId);
  for (const id of ids) {
    await mutateSighting(id, s => {
      if (s.userId === deviceId) { s.userId = u.id; s.userName = displayName(u); s.claimedFrom = deviceId; }
      const theirs = (s.ratings || []).filter(r => r.userId === deviceId || r.userId === u.id).sort((a, b) => b.at - a.at);
      if (theirs.length) s.ratings = [...s.ratings.filter(r => r.userId !== deviceId && r.userId !== u.id), { ...theirs[0], userId: u.id }];
      for (const f of ['helper', 'resolved']) if (s[f]?.userId === deviceId) { s[f].userId = u.id; s[f].name = displayName(u); }
      s.serverAt = Date.now();
    });
  }
  return ids.length;
}

/** claimDevice is idempotent and re-runs on later progress syncs, so a failure here must not fail sign-in. */
const claimSoon = (u, deviceId, deviceSecret) =>
  claimDevice(u, deviceId, deviceSecret).catch(e => console.error('claim failed (will retry on next sync):', e.message));

// ---------- accounts ----------

function addToken(u, tokenHash) { u.tokens = [...(u.tokens || []), tokenHash].slice(-10); }
const newToken = () => randomBytes(32).toString('hex');

function validCredentials(b) {
  const username = str(b.username, 40).toLowerCase();
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) throw httpError(400, 'Username: 3–20 letters, numbers, _ or .');
  if (typeof b.password !== 'string' || b.password.length < 6 || b.password.length > 100) throw httpError(400, 'Password needs at least 6 characters.');
  return username;
}

async function register(req, b) {
  attempt(req, 'register'); // counted before any await, so a parallel burst can't slip past the limit
  const username = validCredentials(b);
  const deviceId = str(b.deviceId, 40);
  const deviceKey = hash(b.deviceSecret);
  const existing = await storage.getUserByName(username);
  if (existing) {
    // A retry of a sign-up whose reply was lost: it must come from the same phone (proved by its
    // secret, not its public id), within minutes, and the password check counts like a login.
    const samePhone = existing.createdDeviceKey && deviceKey === existing.createdDeviceKey
      && Date.now() - existing.createdAt < 15 * 60e3;
    if (!samePhone) throw httpError(409, 'That username is taken.');
    attempt(req, 'login');
    if (!(await checkSecret(b.password, existing.passHash))) throw httpError(409, 'That username is taken.');
    succeeded(req, 'login');
    const token = newToken(), recoveryCode = newRecoveryCode();
    const recoveryHash = await hashSecret(normCode(recoveryCode));
    const u = await mutateUser(existing.id, x => {
      if (x.passHash !== existing.passHash) throw httpError(409, 'That username is taken.');
      addToken(x, sha(token));
      x.recoveryHash = recoveryHash;
    });
    await claimSoon(u, deviceId, b.deviceSecret);
    return { token, user: publicUser(u), recoveryCode };
  }
  const token = newToken(), recoveryCode = newRecoveryCode(), now = Date.now();
  const u = {
    id: 'u-' + randomBytes(8).toString('hex'),
    username,
    passHash: await hashSecret(b.password),
    recoveryHash: await hashSecret(normCode(recoveryCode)),
    createdAt: now,
    createdDeviceKey: deviceKey,
    role: 'player',
    shelter: null,
    profile: { name: cleanName(b.name, 24) || username, avatar: str(b.avatar, 8) || '🧢', xp: 0, stats: emptyStats(), badges: [], rewarded: {}, quests: null },
    profileAt: now,
    devices: {},
    tokens: [sha(token)],
  };
  // Saved before anyone is told about it, so a failed write leaves nothing half-created.
  if (!(await storage.insertUser(u))) throw httpError(409, 'That username is taken.');
  await claimSoon(u, deviceId, b.deviceSecret);
  return { token, user: publicUser(u), recoveryCode };
}

async function login(req, b) {
  attempt(req, 'login');
  const found = await storage.getUserByName(str(b.username, 40).toLowerCase());
  if (!found || !(await checkSecret(b.password, found.passHash))) throw httpError(401, 'Wrong username or password.');
  succeeded(req, 'login');
  const token = newToken();
  const u = await mutateUser(found.id, x => {
    if (x.passHash !== found.passHash) throw httpError(401, 'Wrong username or password.'); // changed meanwhile
    addToken(x, sha(token));
  });
  await claimSoon(u, str(b.deviceId, 40), b.deviceSecret);
  return { token, user: publicUser(u) };
}

/** Forgot your password? Username + recovery code sets a new one (and a fresh code). */
async function recover(req, b) {
  attempt(req, 'recover');
  const found = await storage.getUserByName(str(b.username, 40).toLowerCase());
  if (!found || !(await checkSecret(normCode(b.recoveryCode), found.recoveryHash))) throw httpError(401, 'Wrong username or recovery code.');
  succeeded(req, 'recover');
  if (typeof b.password !== 'string' || b.password.length < 6 || b.password.length > 100) throw httpError(400, 'Password needs at least 6 characters.');
  const token = newToken(), recoveryCode = newRecoveryCode();
  const passHash = await hashSecret(b.password), recoveryHash = await hashSecret(normCode(recoveryCode));
  // Every other phone is signed out.
  const u = await mutateUser(found.id, x => {
    if (x.recoveryHash !== found.recoveryHash) throw httpError(401, 'Wrong username or recovery code.'); // already used
    x.passHash = passHash; x.recoveryHash = recoveryHash; x.tokens = [sha(token)];
  });
  await claimSoon(u, str(b.deviceId, 40), b.deviceSecret);
  return { token, user: publicUser(u), recoveryCode };
}

async function logout(req, auth) {
  const m = BEARER.exec(req.headers.authorization || '');
  if (auth && m) await mutateUser(auth.id, x => { x.tokens = (x.tokens || []).filter(t => t !== sha(m[1])); });
  return { ok: true };
}

/**
 * Progress sync. Each phone reports its own lifetime totals (so resending is harmless);
 * the account's XP and stats are the sum over phones. Badges, reward history and quests merge.
 */
async function progress(auth, b) {
  const device = str(b.device, 40);
  if (!/^d-[a-z0-9]{4,38}$/i.test(device)) throw httpError(400, 'bad device');
  const u = await mutateUser(auth.id, x => {
    x.devices ||= {};
    const r = x.devices.retired;
    if (!x.devices[device] && r?.from?.[device]) {
      // A folded phone came back: move its totals out of "retired" so they aren't counted twice.
      const f = r.from[device];
      r.xp -= f.xp;
      for (const k of STAT_KEYS) r.stats[k] -= f.stats[k] || 0;
      x.devices[device] = f;
      delete r.from[device];
    }
    const slots = Object.keys(x.devices).filter(k => k !== 'retired');
    if (!x.devices[device] && slots.length >= 50) {
      // Fold the longest-unused phone into one "retired" slot instead of turning new phones away.
      const oldest = slots.sort((a, c) => (x.devices[a].at || 0) - (x.devices[c].at || 0))[0];
      const ret = (x.devices.retired ||= { xp: 0, stats: emptyStats(), from: {} });
      ret.from ||= {};
      ret.xp += x.devices[oldest].xp;
      for (const k of STAT_KEYS) ret.stats[k] = (ret.stats[k] || 0) + (x.devices[oldest].stats[k] || 0);
      ret.from[oldest] = x.devices[oldest];
      const kept = Object.keys(ret.from);
      if (kept.length > 500) delete ret.from[kept[0]]; // bounded: very old phones simply stay retired
      delete x.devices[oldest];
    }
    const d = (x.devices[device] ||= { xp: 0, stats: emptyStats() });
    d.xp = Math.max(d.xp, int(b.dev?.xp, 0, 1e7));
    for (const k of STAT_KEYS) d.stats[k] = Math.max(d.stats[k] || 0, int(b.dev?.stats?.[k], 0, 1e6));
    d.at = Date.now();

    const p = x.profile;
    const devs = Object.values(x.devices);
    p.xp = devs.reduce((a, v) => a + v.xp, 0);
    p.stats = Object.fromEntries(STAT_KEYS.map(k => [k, devs.reduce((a, v) => a + (v.stats[k] || 0), 0)]));
    if (Array.isArray(b.badges)) p.badges = [...new Set([...p.badges, ...b.badges.filter(v => typeof v === 'string' && v.length <= 20)])].slice(0, 50);
    if (b.rewarded && typeof b.rewarded === 'object') {
      // Linear, and the cap counts new keys only, so a long history keeps syncing in later requests.
      let size = Object.keys(p.rewarded).length, added = 0;
      for (const k of Object.keys(b.rewarded)) {
        if (size >= 20000 || added >= 2000) break;
        if (/^[a-z]{2,12}:[a-z0-9-]{4,40}$/i.test(k) && !Object.hasOwn(p.rewarded, k)) { p.rewarded[k] = 1; size++; added++; }
      }
    }
    const q = b.quests;
    if (q && typeof q === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
      const cur = p.quests;
      const clean = v => ({ date: v.date, catch: int(v.catch, 0, 99), rate: int(v.rate, 0, 99), help: int(v.help, 0, 99),
        done: Array.isArray(v.done) ? v.done.filter(d2 => ['catch', 'rate', 'help'].includes(d2)) : [] });
      if (!cur || q.date > cur.date) p.quests = clean(q);
      else if (q.date === cur.date) {
        const c = clean(q);
        p.quests = { date: cur.date, catch: Math.max(cur.catch, c.catch), rate: Math.max(cur.rate, c.rate),
          help: Math.max(cur.help, c.help), done: [...new Set([...cur.done, ...c.done])] };
      }
    }
    const at = clampTime(b.profileAt, Date.now());
    if (b.profileAt && at > x.profileAt) {
      p.name = cleanName(b.name, 24) || p.name;
      p.avatar = str(b.avatar, 8) || p.avatar;
      x.profileAt = at;
    }
  });
  // Pick up anything this phone uploaded anonymously that raced the sign-in.
  if (b.deviceId) await claimSoon(u, str(b.deviceId, 40), b.deviceSecret);
  return publicUser(u);
}

async function applyShelter(auth, b) {
  if (isShelter(auth)) throw httpError(409, 'You are already a verified shelter.');
  const name = cleanName(b.name, 60), phone = str(b.phone, 30);
  if (name.length < 2) throw httpError(400, 'Shelter name is required.');
  if (phone.replace(/\D/g, '').length < 8) throw httpError(400, 'A phone or Zalo number is required.');
  const u = await mutateUser(auth.id, x => {
    x.shelter = { status: 'pending', name, phone, area: str(b.area, 60), link: str(b.link, 200), note: str(b.note, 400), appliedAt: Date.now() };
  });
  return publicUser(u);
}

// ---------- admin ----------

function isAdmin(req) {
  if (!ADMIN_KEY) throw httpError(503, 'Admin is disabled: set the ADMIN_KEY environment variable.');
  const k = req.headers['x-admin-key'];
  if (typeof k !== 'string' || !k) return false;
  return timingSafeEqual(Buffer.from(sha(k)), Buffer.from(sha(ADMIN_KEY)));
}
/** The right key always works; wrong keys are rate-limited. */
function requireAdmin(req) {
  if (isAdmin(req)) return;
  checkRate(req, 'admin');
  failed(req, 'admin');
  throw httpError(401, 'Wrong admin key.');
}

async function adminUsers() {
  const [users, sightings] = await Promise.all([storage.listUsers(), storage.listSightings()]);
  const count = new Map();
  for (const s of sightings) count.set(s.userId, (count.get(s.userId) || 0) + 1);
  return users.map(u => ({
    id: u.id, username: u.username, role: u.role, shelter: u.shelter, createdAt: u.createdAt,
    name: u.profile.name, xp: u.profile.xp, sightings: count.get(u.id) || 0,
  })).sort((a, b) => (b.shelter?.appliedAt || 0) - (a.shelter?.appliedAt || 0) || b.createdAt - a.createdAt);
}

async function adminAction(b) {
  const now = Date.now();
  let recoveryCode = null, recoveryHash = null;
  if (b.action === 'recovery') {
    // For someone who lost both password and recovery code: give them this new code in person.
    recoveryCode = newRecoveryCode();
    recoveryHash = await hashSecret(normCode(recoveryCode));
  } else if (!['approve', 'reject', 'revoke'].includes(b.action)) {
    throw httpError(400, 'Unknown action.');
  }
  const u = await mutateUser(str(b.userId, 40), x => {
    if (recoveryHash) { x.recoveryHash = recoveryHash; return; }
    if (!x.shelter) throw httpError(400, 'This user has not applied as a shelter.');
    if (b.action === 'approve') {
      // Approve exactly the application the admin looked at, not one edited since.
      if (b.appliedAt !== x.shelter.appliedAt) throw httpError(409, 'The application changed since you loaded it. Reload and check it again.');
      x.role = 'shelter';
      x.shelter = { ...x.shelter, status: 'approved', reviewedAt: now };
    } else {
      x.role = 'player';
      x.shelter = { ...x.shelter, status: b.action === 'reject' ? 'rejected' : 'revoked', reviewedAt: now };
    }
  });
  return { user: { id: u.id, username: u.username, role: u.role, shelter: u.shelter }, ...(recoveryCode ? { recoveryCode } : {}) };
}

// ---------- sightings ----------

const ID = /^[a-z0-9-]{4,40}$/i;
const STATUSES = new Set([null, 'urgent', 'help', 'ok', 'owned']);
// Anyone may update these (that's the point of the rescue board)...
const SHARED = ['status', 'helper', 'resolved'];
// ...but only the person who posted the sighting may change these.
const AUTHOR = ['nickname', 'note', 'species', 'lat', 'lng', 'ownPet', 'adoption'];
const MAX_RATINGS = 1000;

function clean(b) {
  const now = Date.now();
  const person = p => (p && typeof p === 'object'
    ? { userId: str(p.userId, 40), name: cleanName(p.name, 60), at: clampTime(p.at, now), ...(p.outcome ? { outcome: str(p.outcome, 20) } : {}) }
    : null);
  const fieldAt = {};
  if (b.fieldAt && typeof b.fieldAt === 'object') {
    for (const f of [...SHARED, ...AUTHOR]) if (b.fieldAt[f]) fieldAt[f] = clampTime(b.fieldAt[f], now);
  }
  return {
    id: b.id,
    createdAt: Math.min(num(b.createdAt) || now, now),
    updatedAt: clampTime(b.updatedAt, now),
    userId: str(b.userId, 40),
    userName: cleanName(b.userName, 60),
    userAvatar: str(b.userAvatar, 8),
    species: Object.hasOwn(SPECIES_BY_ID, b.species) ? b.species : 'other',
    nickname: str(b.nickname, 40),
    note: str(b.note, 280),
    lat: Math.max(-90, Math.min(90, num(b.lat))),
    lng: Math.max(-180, Math.min(180, num(b.lng))),
    status: STATUSES.has(b.status) ? b.status : null,
    ownPet: !!b.ownPet,
    ratings: Array.isArray(b.ratings)
      ? b.ratings.slice(0, MAX_RATINGS).map(r => ({ userId: str(r?.userId, 40), score: int(Math.round(num(r?.score)), 1, 5), at: clampTime(r?.at, now) }))
      : [],
    adoption: b.adoption && typeof b.adoption === 'object' ? {
      open: !!b.adoption.open, age: str(b.adoption.age, 30), vaccinated: !!b.adoption.vaccinated,
      sterilized: !!b.adoption.sterilized, contact: str(b.adoption.contact, 60),
    } : null,
    helper: person(b.helper),
    resolved: person(b.resolved),
    fieldAt,
  };
}

const publicView = ({ ownerHash, v, claimedFrom, ...s }) => s;

/**
 * "I'm on it" / "Helped" always record who actually sent them; the server marks them verified
 * only for an approved shelter's account. Clients can't set `verified` or act in someone else's name.
 */
function stampPerson(p, actor, auth) {
  if (!p) return null;
  p.userId = actor;
  if (auth) p.name = displayName(auth);
  p.verified = isShelter(auth);
  return p;
}

async function upsert(req, body, auth) {
  if (typeof body.id !== 'string' || !ID.test(body.id)) throw httpError(400, 'bad id');
  const incoming = clean(body);
  const claimedActor = auth ? auth.id : str(body.actorId, 40);
  // A create that would be refused anyway shouldn't register an anonymous id first.
  if (!(await storage.getSighting(incoming.id)) && incoming.userId !== claimedActor) throw httpError(409, 'Unknown sighting.');
  let actor;
  if (auth) actor = auth.id;
  else if (await proveAnon(claimedActor, hash(body.ownerKey))) actor = claimedActor;
  else throw httpError(403, 'This player id belongs to another device. Sign in, or reset the app.');

  // A request can only add or change its sender's own rating.
  const myRating = incoming.ratings.filter(r => r.userId === actor).sort((a, b) => b.at - a.at)[0];
  const photo = typeof body.photo === 'string' && body.photo.startsWith('data:image/')
    ? Buffer.from(body.photo.slice(body.photo.indexOf(',') + 1), 'base64') : null;
  if (photo) attempt(req, 'photo');
  let photoSaved = false;
  // The photo goes first: if that fails, nothing is published and the phone retries later.
  const savePhoto = async () => { if (photo && !photoSaved) { await storage.savePhoto(incoming.id, photo); photoSaved = true; } };

  for (let i = 0; i < 8; i++) {
    const existing = await storage.getSighting(incoming.id);
    if (!existing) {
      // Only the author can (re)create a sighting, so a record the server lost can't come back as someone else's.
      if (!incoming.userId || incoming.userId !== actor) throw httpError(409, 'Unknown sighting.');
      if (auth) incoming.userName = displayName(auth);
      await savePhoto();
      // Stamped after the upload, right before the write, so incremental syncs can't miss it.
      const doc = { ...incoming, ratings: myRating ? [myRating] : [], serverAt: Date.now() };
      if (photo) doc.photo = `/photos/${doc.id}.jpg`;
      for (const f of ['helper', 'resolved']) {
        if (doc[f]?.userId === actor) stampPerson(doc[f], actor, auth);
        else doc[f] = null;
      }
      if (await storage.insertSighting(doc)) return publicView(doc);
      continue; // created by a concurrent request: merge into it instead
    }

    // The anonymous id a sign-in replaced still counts as the owner (its edits may have raced the claim).
    const isOwner = existing.userId === actor || (!!existing.claimedFrom && existing.claimedFrom === actor);
    const doc = structuredClone(existing);
    // Per-field last-write-wins, so a stale copy of the record can't undo someone else's
    // "Helped" or "I'm on it" just because it touched a different field more recently.
    // A field only changes when the client stamped it (a rating-only push stamps nothing).
    const fieldTime = f => existing.fieldAt?.[f] ?? existing.createdAt ?? 0;
    doc.fieldAt ||= {};
    for (const f of [...SHARED, ...(isOwner ? AUTHOR : [])]) {
      if (incoming.fieldAt[f] && incoming.fieldAt[f] > fieldTime(f)) {
        doc[f] = (f === 'helper' || f === 'resolved') ? stampPerson(structuredClone(incoming[f]), actor, auth) : incoming[f];
        doc.fieldAt[f] = incoming.fieldAt[f];
      }
    }
    if (myRating) {
      const old = (doc.ratings || []).find(r => r.userId === actor);
      if (!old || old.at <= myRating.at) {
        doc.ratings = [...(doc.ratings || []).filter(r => r.userId !== actor), myRating]
          .sort((a, b) => b.at - a.at).slice(0, MAX_RATINGS);
      }
    }
    if (isOwner && photo) { await savePhoto(); doc.photo = `/photos/${doc.id}.jpg`; }
    doc.updatedAt = Math.max(existing.updatedAt, incoming.updatedAt);
    doc.serverAt = Date.now(); // after any upload, right before the write
    if (await storage.updateSighting(doc, existing.v || 0)) return publicView(doc);
  }
  throw httpError(503, 'Busy, please try again.');
}

// ---------- http ----------

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function sendFile(res, file) {
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return false;
  // Hashed assets can be cached; the HTML shell and service worker must stay fresh.
  const immutable = file.includes(`${'/'}assets${'/'}`);
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=604800' : 'no-cache',
  });
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
  return true;
}

function json(res, code, data, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

function readJson(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(httpError(413, 'too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bad json');
        resolve(body);
      } catch { reject(httpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
  res.setHeader('Access-Control-Expose-Headers', 'X-Server-Time');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  let url;
  try { url = new URL(req.url, 'http://x'); url.pathname = decodeURIComponent(url.pathname); }
  catch { return json(res, 400, { error: 'bad url' }); }
  const path = url.pathname;
  const post = req.method === 'POST';

  if (path === '/healthz') return json(res, 200, { ok: true });

  // A session that no longer exists is an error, never a silent fall-back to anonymous.
  let auth = null;
  if (req.headers.authorization && path.startsWith('/api/') && !path.startsWith('/api/auth/')) {
    const m = BEARER.exec(req.headers.authorization);
    auth = m ? await storage.getUserByToken(sha(m[1])) : null;
    if (!auth) throw httpError(401, 'Please sign in again.');
  }
  const needAuth = () => { if (!auth) throw httpError(401, 'Please sign in again.'); return auth; };

  if (path === '/api/health') {
    return json(res, 200, { ok: true, name: 'saigon-critters', accounts: true, storage: storage.kind, serverId: await storage.serverId() });
  }
  if (path === '/api/sightings' && !post) {
    // ?since= returns only what changed (cheap on mobile data); a full list lets phones notice removals.
    const since = num(url.searchParams.get('since'));
    const now = Date.now();
    const list = await storage.listSightings(since || 0);
    return json(res, 200, list.map(publicView), { 'X-Server-Time': String(now) });
  }
  if (path === '/api/sightings' && post) {
    attempt(req, 'upload');
    return json(res, 200, await upsert(req, await readJson(req), auth));
  }

  if (post && path === '/api/auth/register') return json(res, 200, await register(req, await readJson(req, 20e3)));
  if (post && path === '/api/auth/login') return json(res, 200, await login(req, await readJson(req, 20e3)));
  if (post && path === '/api/auth/recover') return json(res, 200, await recover(req, await readJson(req, 20e3)));
  if (post && path === '/api/auth/logout') {
    const m = BEARER.exec(req.headers.authorization || '');
    const u = m ? await storage.getUserByToken(sha(m[1])) : null;
    return json(res, 200, await logout(req, u));
  }
  if (post && path === '/api/me/progress') return json(res, 200, await progress(needAuth(), await readJson(req, 2e6)));
  if (post && path === '/api/shelter/apply') return json(res, 200, await applyShelter(needAuth(), await readJson(req, 20e3)));

  if (path.startsWith('/api/admin/')) {
    requireAdmin(req);
    if (path === '/api/admin/users' && !post) return json(res, 200, await adminUsers());
    if (path === '/api/admin/users' && post) return json(res, 200, await adminAction(await readJson(req, 20e3)));
    // Lets you check TRUST_PROXY after deploying: clientIp should be your own public IP.
    if (path === '/api/admin/ip') return json(res, 200, { clientIp: ipOf(req), remoteAddress: req.socket.remoteAddress, forwardedFor: req.headers['x-forwarded-for'] || null });
  }
  if (path.startsWith('/api/')) return json(res, 404, { error: 'not found' });

  if (path === '/admin' || path === '/admin/') { if (sendFile(res, ADMIN_PAGE)) return; }
  if (path.startsWith('/photos/')) {
    const m = /^\/photos\/([a-z0-9-]{4,40})\.jpg$/i.exec(path);
    const buf = m && await storage.readPhoto(m[1]);
    if (!buf) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' });
    return res.end(buf);
  }
  // Static web app
  const file = normalize(join(DIST, path === '/' ? 'index.html' : path));
  if (file.startsWith(DIST) && sendFile(res, file)) return;
  if (sendFile(res, join(DIST, 'index.html'))) return;
  json(res, 404, { error: 'Build the web app first: npm run build' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    if (!e.status) console.error(e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'server error' });
    else res.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`🐾 Saigon Critters server on http://localhost:${PORT} (storage: ${storage.kind})`);
  console.log(ADMIN_KEY
    ? `🔑 Shelter admin page: /admin (key: ${process.env.ADMIN_KEY ? 'ADMIN_KEY env var' : ADMIN_KEY_FILE})`
    : '⚠️  Admin page disabled: set ADMIN_KEY');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => storage.close().finally(() => process.exit(0))));
}

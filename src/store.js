// Offline-first data layer.
// Every sighting lives in IndexedDB on the device. If a community server URL is
// set in Profile, new/changed sightings are pushed to it and everyone else's
// sightings are pulled down, so shelters see the same rescue board.

import { get, set, del } from 'idb-keyval';
import { demoSightings } from './seed.js';
import { authHeaders, syncProgress, scheduleProgressSync, handleUnauthorized, forgetAuth, isShelter, authUserId } from './account.js';

const ME_KEY = 'sc_me';
const SETTINGS_KEY = 'sc_settings';
const DB_KEY = 'sightings';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
const STAT_KEYS = ['catches', 'rated', 'helped', 'rescued', 'adoptions'];
const zeroStats = () => Object.fromEntries(STAT_KEYS.map(k => [k, 0]));

function readJSON(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; }
  catch { return { ...fallback }; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

function freshPlayer() {
  return {
    id: 'u-' + uid(),
    // Proves to the community server that we posted a sighting, so only we can edit its details.
    secret: secret(),
    // This phone's slot in an account's progress (see account.js).
    device: 'd-' + uid(),
    name: '',
    avatar: '🧢',
    profileAt: 0,
    xp: 0,
    badges: [],
    stats: zeroStats(),
    // What this phone has earned; an account's XP is the sum over its phones.
    dev: { xp: 0, stats: zeroStats() },
    rewarded: {},
    quests: null,
    createdAt: Date.now(),
  };
}

const storedMe = (() => {
  try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch { return null; }
})();
export const me = { ...freshPlayer(), ...(storedMe || {}) };
me.stats = { ...zeroStats(), ...me.stats };
// Players from before accounts existed: everything so far was earned on this phone.
if (storedMe && typeof storedMe.dev?.xp !== 'number') me.dev = { xp: me.xp, stats: { ...me.stats } };

// While "Reset my data" runs, nothing (e.g. a sync still in flight) may write the old data back.
let resetting = false;
/** Save without triggering a progress upload (used when applying what the server sent). */
export const persistMe = () => { if (!resetting) writeJSON(ME_KEY, me); };
export const saveMe = () => { if (resetting) return; persistMe(); scheduleProgressSync(); };
writeJSON(ME_KEY, me);

/**
 * The secret that proves we posted a sighting is different for every server, so a server we
 * try out can't use it to claim our sightings on another one.
 */
export function ownerSecret() {
  // Keyed by the server's own id when known, so two addresses of one server share a key.
  const key = settings.serverId || normUrl(settings.serverUrl);
  me.secrets ||= {};
  if (!me.secrets[key]) {
    // The first server keeps the phone's original secret, so earlier posts stay ours.
    me.secrets[key] = Object.keys(me.secrets).length ? secret() : me.secret;
    persistMe();
  }
  return me.secrets[key];
}

export const normUrl = u => String(u || '').trim().replace(/\/+$/, '');

/** Remember which community this is (from /api/health), carrying over a key made before we knew. */
function learnServerId(id) {
  if (typeof id !== 'string' || !/^srv-[a-z0-9]{6,40}$/i.test(id) || settings.serverId === id) return;
  me.secrets ||= {};
  const urlKey = normUrl(settings.serverUrl);
  if (!me.secrets[id] && me.secrets[urlKey]) { me.secrets[id] = me.secrets[urlKey]; persistMe(); }
  settings.serverId = id;
  saveSettings();
}
/** Before the first upload to a server, find out its id. */
export async function ensureServerId() {
  if (!settings.serverUrl || settings.serverId) return;
  try {
    const res = await fetch(base() + '/api/health');
    if (res.ok) learnServerId((await res.json()).serverId);
  } catch { /* offline: try again next sync */ }
}

/** Call when the player changes their name or avatar (newest edit wins across phones). */
export const touchProfile = () => { me.profileAt = Date.now(); saveMe(); };

/** Signing out: this phone goes back to a brand-new anonymous player. */
export function resetPlayer() {
  for (const k of Object.keys(me)) delete me[k];
  Object.assign(me, freshPlayer());
  writeJSON(ME_KEY, me);
}

/** After sign-in: what this phone did anonymously (sightings, ratings, on-it/helped) now belongs to the account. */
export async function adoptAccount(oldId, newId, name) {
  for (const s of sightings) {
    if (s.userId === oldId) { s.userId = newId; s.userName = name; }
    const theirs = (s.ratings || []).filter(r => r.userId === oldId || r.userId === newId).sort((a, b) => b.at - a.at);
    if (theirs.length) s.ratings = [...s.ratings.filter(r => r.userId !== oldId && r.userId !== newId), { ...theirs[0], userId: newId }];
    for (const f of ['helper', 'resolved']) if (s[f]?.userId === oldId) s[f] = { ...s[f], userId: newId, name };
  }
  await persist();
  emit();
}

// VITE_SERVER_URL bakes a community server into a build (handy for the APK).
export const settings = readJSON(SETTINGS_KEY, {
  serverUrl: import.meta.env.VITE_SERVER_URL || '',
  showDemo: true,
  seeded: false,
});
export const saveSettings = () => writeJSON(SETTINGS_KEY, settings);

let sightings = [];
const listeners = new Set();
export const subscribe = fn => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach(fn => fn());

export let syncState = { ok: null, at: 0, error: '' };

export async function init() {
  // Phones signed in before accountId existed: remember which account this progress belongs to.
  if (!me.accountId && authUserId() === me.id) { me.accountId = me.id; persistMe(); }
  sightings = (await get(DB_KEY)) || [];
  if (!settings.seeded) {
    const have = new Set(sightings.map(s => s.id));
    sightings.push(...demoSightings().filter(d => !have.has(d.id)));
    settings.seeded = true;
    saveSettings();
    await persist();
  }
  // When the web app is served by the community server itself, join it automatically.
  if (!settings.serverUrl && !settings.autoJoined) {
    try {
      const res = await fetch('./api/health');
      const health = res.ok ? await res.json() : null;
      if (health?.name === 'saigon-critters') {
        settings.serverUrl = normUrl(new URL('.', location.href).href);
        settings.autoJoined = true;
        saveSettings();
        learnServerId(health.serverId);
      }
    } catch { /* not served by a community server */ }
  }
  if (settings.serverUrl) sync();
  setInterval(() => settings.serverUrl && sync(), 60e3);
}

export const emitChange = () => emit();

async function persist() { if (!resetting) await set(DB_KEY, sightings); }

export function all() {
  return settings.showDemo ? sightings : sightings.filter(s => !s.demo);
}
export const byId = id => sightings.find(s => s.id === id);
export const mine = () => sightings.filter(s => s.userId === me.id);

/**
 * With a community server, only an approved shelter's "Helped" closes a case; a player's report
 * waits for a shelter to confirm. Without a server there are no shelters, so any "Helped" counts.
 */
// An owner closing their own adoption listing needs no shelter.
export const isClosed = s => !!s.resolved && (s.resolved.verified || !settings.serverUrl || s.demo || s.ownPet);
export const awaitsCheck = s => !!s.resolved && !isClosed(s) && (s.status === 'urgent' || s.status === 'help');
// Demo animals never count as real cases once a community server is shared.
export const isOpenCase = s => (s.status === 'urgent' || s.status === 'help') && !s.ownPet && !isClosed(s)
  && !(s.demo && settings.serverUrl);

export function conditionOf(s) {
  if (!s.ratings?.length) return null;
  return s.ratings.reduce((a, r) => a + r.score, 0) / s.ratings.length;
}

/** Dogs & cats that still need someone, most urgent first. Demo cases drop out once real data is shared. */
export function rescueList() {
  const rank = { urgent: 0, help: 1 };
  return all()
    .filter(isOpenCase)
    .filter(s => !(s.demo && settings.serverUrl))
    // Reports waiting for a shelter's confirmation go below the open cases.
    .sort((a, b) => awaitsCheck(a) - awaitsCheck(b)
      || rank[a.status] - rank[b.status]
      || (conditionOf(a) ?? 3) - (conditionOf(b) ?? 3)
      || b.createdAt - a.createdAt);
}

export const adoptionList = () =>
  all().filter(s => s.adoption?.open).sort((a, b) => b.createdAt - a.createdAt);

export async function addSighting(data) {
  const now = Date.now();
  const s = {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    userId: me.id,
    userName: me.name || 'Anonymous',
    userAvatar: me.avatar,
    ratings: [],
    helper: null,
    resolved: null,
    adoption: null,
    ownPet: false,
    status: null,
    note: '',
    fieldAt: {},
    ...data,
    dirty: true,
  };
  if (data.condition) s.ratings = [{ userId: me.id, score: data.condition, at: now }];
  delete s.condition;
  sightings.push(s);
  await persist();
  emit();
  push(s);
  return s;
}

/** Apply a local edit. `fields` are stamped so the server can merge per field. */
async function change(id, fields, fn) {
  const s = byId(id);
  if (!s) return null;
  fn(s);
  const now = Date.now();
  s.updatedAt = now;
  s.fieldAt = { ...s.fieldAt };
  for (const f of fields) s.fieldAt[f] = now;
  s.dirty = !s.demo;
  await persist();
  emit();
  if (!s.demo) push(s);
  return s;
}

export const rate = (id, score) => change(id, [], s => {
  s.ratings = (s.ratings || []).filter(r => r.userId !== me.id);
  s.ratings.push({ userId: me.id, score, at: Date.now() });
});
export const setStatus = (id, status) => change(id, ['status'], s => { s.status = status; });
export const claim = id => change(id, ['helper'], s => {
  s.helper = s.helper?.userId === me.id ? null : { userId: me.id, name: me.name || 'Someone', at: Date.now() };
});
export const resolve = (id, outcome) => change(id, ['resolved', 'adoption'], s => {
  // The server decides `verified` for real; this just keeps a shelter's own screen right meanwhile.
  s.resolved = { userId: me.id, name: me.name || 'Someone', at: Date.now(), outcome, verified: isShelter() };
  if (s.adoption) s.adoption = { ...s.adoption, open: false };
});
// A reopened case needs a fresh volunteer: the old "on it" no longer applies.
export const reopen = id => change(id, ['resolved', 'helper'], s => { s.resolved = null; s.helper = null; });

export async function removeDemo() {
  sightings = sightings.filter(s => !s.demo);
  await persist();
  emit();
}
export async function restoreDemo() {
  sightings = sightings.filter(s => !s.demo).concat(demoSightings());
  settings.showDemo = true;
  saveSettings();
  await persist();
  emit();
}
export async function resetEverything() {
  resetting = true;
  sightings = [];
  await del(DB_KEY);
  localStorage.removeItem(ME_KEY);
  localStorage.removeItem(SETTINGS_KEY);
  forgetAuth(); // a fresh player can't keep using the old account's session
}

// ---------- community server sync ----------

const base = () => settings.serverUrl.replace(/\/+$/, '');
const absolutePhoto = p => (typeof p === 'string' && p.startsWith('/photos/') ? base() + p : null);
const VALID_STATUS = new Set(['urgent', 'help', 'ok', 'owned']);

/** Server data is untrusted: only accept well-formed records. */
function validRemote(r) {
  return r && typeof r === 'object' && /^[a-z0-9-]{4,40}$/i.test(r.id)
    && Number.isFinite(r.lat) && Number.isFinite(r.lng) && Array.isArray(r.ratings);
}

function mergeFromServer(remote) {
  if (!validRemote(remote)) return;
  const local = byId(remote.id);
  const photo = local?.photo?.startsWith('data:') ? local.photo : absolutePhoto(remote.photo);
  const merged = {
    ...remote,
    status: VALID_STATUS.has(remote.status) ? remote.status : null,
    ratings: remote.ratings.filter(r => r && Number.isFinite(r.score) && r.score >= 1 && r.score <= 5),
    adoption: remote.adoption && typeof remote.adoption === 'object'
      ? { ...remote.adoption, contact: typeof remote.adoption.contact === 'string' ? remote.adoption.contact : '' }
      : null,
    photo,
    photoUploaded: true,
    dirty: false,
  };
  if (local) Object.assign(local, merged);
  else sightings.push(merged);
}

/** Upload one sighting. Returns false if it's still waiting (offline, server error). */
async function push(s) {
  if (!settings.serverUrl || s.demo) return true;
  const sentAt = s.updatedAt;
  const sentPhoto = !s.photoUploaded && !!s.photo?.startsWith('data:');
  try {
    const { dirty, photoUploaded, ...body } = s;
    if (!sentPhoto) delete body.photo;
    body.ownerKey = ownerSecret();
    body.actorId = me.id;
    const res = await fetch(base() + '/api/sightings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (res.status === 409 && s.userId !== me.id) {
      // The server doesn't have someone else's sighting any more: it's an orphan here too.
      // (Our own sightings are never dropped; they stay pending until they upload.)
      sightings = sightings.filter(x => x.id !== s.id);
      await persist();
      emit();
      return true;
    }
    if (res.status === 401 || res.status === 403) handleUnauthorized();
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const saved = await res.json();
    const cur = byId(s.id);
    if (cur && cur.updatedAt > sentAt) {
      // Edited again while this request was in flight: keep the newer local copy (still dirty).
      if (sentPhoto) cur.photoUploaded = true;
    } else {
      mergeFromServer(saved);
      // The server had lost our photo and we didn't send it: send it with the next upload.
      if (cur && !saved.photo && cur.photo?.startsWith('data:')) { cur.photoUploaded = false; cur.dirty = true; }
    }
    await persist();
    emit();
    return true;
  } catch (e) {
    syncState = { ok: false, at: Date.now(), error: e.message };
    return false;
  }
}

const pendingUploads = () => sightings.filter(x => x.dirty && !x.demo);

let syncRun = null, syncAgain = false;
/** Upload pending changes and download everyone's sightings. Concurrent callers share one run. */
export function sync() {
  if (!settings.serverUrl) return Promise.resolve();
  if (syncRun) { syncAgain = true; return syncRun; }
  syncRun = runSync().finally(() => {
    syncRun = null;
    if (syncAgain) { syncAgain = false; return sync(); }
  });
  return syncRun;
}

// Most syncs only fetch what changed since the last one (light on mobile data); every 20 minutes
// a full list lets the phone notice sightings that were removed or lost on the server.
let lastPull = { server: '', at: 0, fullAt: 0 };

async function runSync() {
  try {
    await ensureServerId();
    for (const s of pendingUploads()) await push(s);
    if (lastPull.server !== base()) lastPull = { server: base(), at: 0, fullAt: 0 };
    const full = !lastPull.at || Date.now() - lastPull.fullAt > 20 * 60e3;
    const res = await fetch(base() + '/api/sightings' + (full ? '' : `?since=${lastPull.at}`));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('bad response');
    const serverTime = Number(res.headers.get('X-Server-Time'));
    const onServer = new Set();
    for (const r of list) {
      if (!validRemote(r)) continue;
      onServer.add(r.id);
      const local = byId(r.id);
      if (local && (local.dirty || local.updatedAt > r.updatedAt)) continue;
      mergeFromServer(r);
    }
    if (full) {
      // Someone else's sighting that's gone from the server (e.g. removed by a moderator): drop it here too.
      sightings = sightings.filter(s => s.demo || s.dirty || s.userId === me.id || onServer.has(s.id));
      // Our own sightings the server doesn't have (new server, or it lost data): upload them again.
      for (const s of mine()) {
        if (!s.demo && !onServer.has(s.id) && !s.dirty) {
          s.dirty = true;
          s.photoUploaded = false;
          await push(s);
        }
      }
      lastPull.fullAt = Date.now();
    }
    // Server clock, minus an overlap, so a write that was still committing during this request isn't skipped.
    if (Number.isFinite(serverTime) && serverTime > 0) lastPull.at = serverTime - 30000;
    for (const s of pendingUploads()) if (s.dirty && s.photoUploaded === false) await push(s);
    await persist();
    const waiting = pendingUploads().length;
    syncState = waiting
      ? { ok: false, at: Date.now(), error: `${waiting} change${waiting > 1 ? 's' : ''} waiting to upload` }
      : { ok: true, at: Date.now(), error: '' };
  } catch (e) {
    syncState = { ok: false, at: Date.now(), error: e.message };
  }
  await syncProgress();
  emit();
}

/** True if some changes (own sightings, ratings, confirmations) haven't reached the server yet. */
export const hasPendingUploads = () => pendingUploads().length > 0;

/** Switch community server. `serverId` comes from its /api/health (null when clearing). */
export async function setServer(url, serverId = null) {
  url = normUrl(url);
  const sameCommunity = url === normUrl(settings.serverUrl) || (serverId && serverId === settings.serverId);
  if (!sameCommunity) {
    // A different community: other people's sightings from the old one don't belong here,
    // ours get uploaded again (with photos), and the old server's session and account don't apply.
    sightings = sightings.filter(s => s.demo || s.userId === me.id);
    for (const s of mine()) if (!s.demo) { s.dirty = true; s.photoUploaded = false; }
    await persist();
    forgetAuth();
    delete me.accountId;
    delete me.anonId;
    persistMe();
    lastPull = { server: '', at: 0, fullAt: 0 };
    settings.serverId = null;
  }
  settings.serverUrl = url;
  saveSettings();
  if (serverId) learnServerId(serverId);
  await sync();
}

export async function testServer(url) {
  const res = await fetch(normUrl(url) + '/api/health');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

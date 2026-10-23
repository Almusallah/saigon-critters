// Optional accounts on the community server.
// Signing in makes progress (XP, badges, quests, stats) and the deck follow you to any phone,
// and lets approved shelters confirm rescues. Without an account everything still works,
// stored only on this phone.
//
// Progress merges without double counting: each phone reports what *it* has earned in total
// (me.dev), the server keeps one slot per phone and the account's XP is the sum of the slots.
// Resending the same totals is harmless, so flaky mobile connections can't inflate anything.

import { me, settings, persistMe, adoptAccount, resetPlayer, sync, emitChange, hasPendingUploads, ownerSecret, ensureServerId } from './store.js';
import { toast } from './ui.js';

const AUTH_KEY = 'sc_auth';
const STAT_KEYS = ['catches', 'rated', 'helped', 'rescued', 'adoptions'];

function readAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || '{}'); } catch { return {}; }
}
/** { token, user: { id, username, role, shelter, profile, profileAt } } when signed in. */
export const auth = readAuth();
const saveAuth = () => { try { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); } catch { /* blocked */ } };

export const signedIn = () => !!auth.token;
export const authUserId = () => auth.user?.id;
export const isShelter = () => auth.user?.role === 'shelter' && auth.user?.shelter?.status === 'approved';
export const authHeaders = () => (auth.token ? { Authorization: `Bearer ${auth.token}` } : {});

export function forgetAuth() {
  delete auth.token;
  delete auth.user;
  saveAuth();
}

let warned = false;
/** The server no longer accepts our session (expired, or signed out from another phone). */
export function handleUnauthorized() {
  const hadSession = !!auth.token;
  if (hadSession) forgetAuth();
  if (!warned) {
    warned = true;
    toast(hadSession || me.accountId
      ? '🔒 Please sign in again to keep syncing (Profile → Account).'
      : '⚠️ The server is refusing uploads from this phone. Sign in, or use Reset my data in Profile.', 5000);
  }
  emitChange();
}

/** Progress this phone earned that the server hasn't acknowledged yet. */
const unsavedProgress = () => me.dev.xp > (me.devSynced?.xp || 0)
  || STAT_KEYS.some(k => (me.dev.stats[k] || 0) > (me.devSynced?.stats?.[k] || 0));

const base = () => settings.serverUrl.replace(/\/+$/, '');

async function api(path, body) {
  if (!settings.serverUrl) throw new Error('Connect to a community server first (Profile → Settings).');
  const res = await fetch(base() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth.token && path.startsWith('/api/me')) handleUnauthorized();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- sign up / in / out ----------

async function enter(path, body, { fresh = false } = {}) {
  await ensureServerId();
  const oldId = me.id;
  const data = await api(path, { ...body, deviceId: me.id, deviceSecret: ownerSecret() });
  if (me.accountId && me.accountId !== data.user.id) {
    // This phone still holds another account's progress (its session had expired).
    if (hasPendingUploads() || unsavedProgress()) {
      // Switching now would lose it: hand the new session back and explain.
      fetch(settings.serverUrl.replace(/\/+$/, '') + '/api/auth/logout',
        { method: 'POST', headers: { Authorization: `Bearer ${data.token}` } }).catch(() => {});
      throw new Error('This phone still has unsaved progress from the account you used before. '
        + 'Sign in to that account first so it gets saved, then switch.');
    }
    resetPlayer(); // everything of the old account is safely online: start clean
  } else {
    // The server moved this phone's anonymous sightings to the account; do the same locally.
    await adoptAccount(oldId, data.user.id, data.user.profile.name);
    // Remembered for a few minutes so syncs can also hand over uploads that raced this sign-in.
    if (oldId !== data.user.id) { me.anonId = oldId; me.anonUntil = Date.now() + 10 * 60e3; }
  }
  auth.token = data.token;
  auth.user = data.user;
  saveAuth();
  warned = false;
  me.id = data.user.id;
  me.accountId = data.user.id;
  // Signing in to an existing account: its name and avatar win over this phone's defaults.
  if (!fresh) me.profileAt = 0;
  persistMe();
  await syncProgress();
  sync();
  return data;
}

/** Returns { user, recoveryCode }. The recovery code is shown once and never again. */
export const register = (username, password) =>
  enter('/api/auth/register', { username, password, name: me.name, avatar: me.avatar }, { fresh: true });

export const login = (username, password) => enter('/api/auth/login', { username, password });

/** Forgot password: username + recovery code → new password (and a new recovery code). */
export const recover = (username, recoveryCode, password) =>
  enter('/api/auth/recover', { username, recoveryCode, password });

export async function logout() {
  const ended = 'Your session has ended. Sign in again so your progress gets saved, then sign out.';
  if (!auth.token) throw new Error(ended);
  await sync();            // push anything still waiting
  if (!auth.token) throw new Error(ended); // the session was revoked meanwhile: nothing was saved
  // Signing out wipes this phone's player, so nothing may be left only here.
  if (hasPendingUploads() || !(await syncProgress())) {
    throw new Error('Some of your progress hasn\'t been saved online yet. Connect to the internet, then sign out.');
  }
  try { await api('/api/auth/logout'); } catch { /* signed out locally anyway */ }
  forgetAuth();
  resetPlayer();           // this phone becomes a fresh anonymous player
}

// ---------- progress ----------

const n = v => (Number.isFinite(+v) && +v >= 0 ? +v : 0);

function applyServerProfile(user, sent) {
  auth.user = user;
  saveAuth();
  // Server data is untrusted: numbers must be numbers, lists must be lists.
  const p = {
    ...user.profile,
    xp: n(user.profile?.xp),
    stats: Object.fromEntries(STAT_KEYS.map(k => [k, n(user.profile?.stats?.[k])])),
    badges: Array.isArray(user.profile?.badges) ? user.profile.badges.filter(b => typeof b === 'string') : [],
    rewarded: user.profile?.rewarded && typeof user.profile.rewarded === 'object' ? user.profile.rewarded : {},
    quests: user.profile?.quests && typeof user.profile.quests === 'object' ? user.profile.quests : null,
  };
  // Server totals include what we sent; add anything earned while the request was in flight.
  me.xp = p.xp + Math.max(0, me.dev.xp - sent.xp);
  for (const k of STAT_KEYS) me.stats[k] = (p.stats[k] || 0) + Math.max(0, (me.dev.stats[k] || 0) - (sent.stats[k] || 0));
  me.badges = [...new Set([...me.badges, ...p.badges])];
  me.rewarded = { ...p.rewarded, ...me.rewarded };
  const q = p.quests, mq = me.quests;
  if (q && (!mq || q.date > mq.date)) me.quests = { ...q };
  else if (q && mq && q.date === mq.date) {
    me.quests = { date: q.date, catch: Math.max(n(q.catch), mq.catch), rate: Math.max(n(q.rate), mq.rate),
      help: Math.max(n(q.help), mq.help), done: [...new Set([...(Array.isArray(q.done) ? q.done : []), ...mq.done])] };
  }
  if (n(user.profileAt) > (me.profileAt || 0)) {
    me.name = String(p.name || me.name);
    me.avatar = String(p.avatar || me.avatar);
    me.profileAt = n(user.profileAt);
  }
  me.syncedAt = Date.now();
  me.devSynced = { xp: sent.xp, stats: { ...sent.stats } };
  persistMe();
}

let inflight = null, again = false, timer = 0;

/**
 * Push this phone's progress and pull the account's merged progress (also refreshes shelter status).
 * Resolves true when the server has it all.
 */
export function syncProgress() {
  if (!auth.token || !settings.serverUrl) return Promise.resolve(true);
  if (inflight) { again = true; return inflight; }
  clearTimeout(timer);
  const sent = { xp: me.dev.xp, stats: { ...me.dev.stats } };
  if (me.anonId && !(Date.now() < me.anonUntil)) { delete me.anonId; delete me.anonUntil; persistMe(); }
  inflight = api('/api/me/progress', {
    ...(me.anonId ? { deviceId: me.anonId, deviceSecret: ownerSecret() } : {}),
    device: me.device,
    dev: sent,
    badges: me.badges,
    rewarded: me.rewarded,
    quests: me.quests,
    name: me.name,
    avatar: me.avatar,
    profileAt: me.profileAt || 0,
  })
    .then(user => { applyServerProfile(user, sent); emitChange(); return true; })
    .catch(() => false) // offline: it's all still on the phone and goes up next time
    .finally(() => {
      inflight = null;
      if (again) { again = false; scheduleProgressSync(); }
    });
  return inflight;
}

/** Debounced sync after XP changes (saveMe calls this). */
export function scheduleProgressSync() {
  if (!auth.token) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncProgress(), 2000);
}

// ---------- shelters ----------

export async function applyAsShelter(fields) {
  const user = await api('/api/shelter/apply', fields);
  auth.user = user;
  saveAuth();
  emitChange();
  return user;
}

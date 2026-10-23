// Production-mode test of the community server: a real MongoDB (in memory) + an S3-compatible bucket
// (s3rver), two server instances at once (like a Render deploy), restarts, accounts, shelters, security.
//
//   npm install --no-save mongodb-memory-server@10 s3rver@3   # test-only, kept out of package.json
//   npm run test:server
import { MongoMemoryServer } from 'mongodb-memory-server';
import S3rver from 's3rver';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT = process.argv[2] || '.';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

const mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 90000 } });
const s3 = new S3rver({ port: 4569, address: 'localhost', silent: true, directory: mkdtempSync(join(tmpdir(), 's3-')), configureBuckets: [{ name: 'critters' }] });
await s3.run();

const ADMIN = 'test-admin-key-123456';
const S3ENV = { PHOTOS_S3_ENDPOINT: 'http://localhost:4569', PHOTOS_S3_REGION: 'us-east-1', PHOTOS_S3_BUCKET: 'critters', PHOTOS_S3_KEY_ID: 'S3RVER', PHOTOS_S3_SECRET: 'S3RVER' };
const baseEnv = { ...process.env, MONGODB_URI: mongo.getUri(), MONGODB_DB: 'critters_test', ADMIN_KEY: ADMIN, TRUST_PROXY: '1', DATA_DIR: mkdtempSync(join(tmpdir(), 'data-')) };
for (const k of Object.keys(S3ENV)) delete baseEnv[k];

const procs = {};
async function start(port, extra = {}) {
  const p = spawn('node', ['server/server.js'], { cwd: PROJECT, env: { ...baseEnv, PORT: String(port), ...extra } });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  procs[port] = p;
  for (let i = 0; i < 60; i++) { await sleep(200); try { if ((await fetch(`http://localhost:${port}/healthz`)).ok) return out; } catch {} }
  throw new Error('server did not start:\n' + out);
}
const stop = port => new Promise(r => { const p = procs[port]; if (!p || p.exitCode !== null) return r(); p.on('exit', r); p.kill('SIGTERM'); });
const api = port => async (path, body, token, headers = {}) => {
  const res = await fetch(`http://localhost:${port}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
};
const A = api(8799), Bx = api(8800);
const admin = { 'X-Admin-Key': ADMIN };

try {
  // ---- 1. Mongo only (no bucket yet) ----
  let banner = await start(8799);
  check('boots on MongoDB', /storage: mongodb\)/.test(banner));
  const anon = { id: 'u-anon12345', secret: 'anon-secret-0123456789abcdef' };
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
  const t0 = Date.now();
  const sighting = { id: 'sight-0001', userId: anon.id, userName: 'Anon', species: 'dog', nickname: 'Mực', lat: 10.77, lng: 106.7,
    status: 'urgent', ratings: [{ userId: anon.id, score: 1, at: t0 }], createdAt: t0, updatedAt: t0,
    photo: 'data:image/jpeg;base64,' + jpeg.toString('base64'), ownerKey: anon.secret, actorId: anon.id };
  let r = await A('/api/sightings', sighting);
  check('anonymous sighting created (photo in MongoDB)', r.status === 200 && r.body.photo === '/photos/sight-0001.jpg');
  r = await A('/api/sightings', { ...sighting, photo: undefined, ownerKey: 'another-device-key-9999' });
  check('another device cannot pose as that anonymous player', r.status === 403);
  await stop(8799);

  // ---- 2. Restart with the bucket: old photo still served (fallback) ----
  banner = await start(8799, S3ENV);
  check('boots on MongoDB + S3', /storage: mongodb\+s3/.test(banner));
  let ph = Buffer.from(await (await fetch('http://localhost:8799/photos/sight-0001.jpg')).arrayBuffer());
  check('photo stored before the bucket existed still loads', ph.equals(jpeg));

  // anonymous player rates someone else's sighting, then registers: rating + sighting move to the account
  const other = { id: 'u-other98765', secret: 'other-secret-0123456789abcd' };
  await A('/api/sightings', { id: 'sight-0002', userId: other.id, species: 'cat', lat: 10.7, lng: 106.6, ratings: [], createdAt: Date.now(), updatedAt: Date.now(), ownerKey: other.secret, actorId: other.id });
  await A('/api/sightings', { id: 'sight-0002', userId: other.id, species: 'cat', lat: 10.7, lng: 106.6, ratings: [{ userId: anon.id, score: 2, at: Date.now() }, { userId: 'u-fake', score: 5, at: Date.now() }], updatedAt: Date.now(), ownerKey: anon.secret, actorId: anon.id });
  r = await A('/api/sightings');
  const s2 = r.body.find(s => s.id === 'sight-0002');
  check('a request only adds its sender\'s own rating', s2.ratings.length === 1 && s2.ratings[0].userId === anon.id);

  r = await A('/api/auth/register', { username: 'mai_test', password: 'pw-123456', name: 'Mai', avatar: '🐰', deviceId: anon.id, deviceSecret: anon.secret });
  check('register', r.status === 200 && !!r.body.token && /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(r.body.recoveryCode));
  const mai = r.body;
  const retry = await A('/api/auth/register', { username: 'mai_test', password: 'pw-123456', deviceId: anon.id, deviceSecret: anon.secret });
  check('sign-up retried after a lost reply succeeds (same phone)', retry.status === 200 && retry.body.user.id === mai.user.id && !!retry.body.recoveryCode);
  const otherPhone = await A('/api/auth/register', { username: 'mai_test', password: 'pw-123456', deviceId: 'u-elsewhere1' });
  check('…but not from another phone', otherPhone.status === 409);
  for (let i = 0; i < 25; i++) {
    const g = await A('/api/auth/register', { username: 'mai_test', password: i === 24 ? 'pw-123456' : 'guess' + i, deviceId: anon.id, deviceSecret: 'not-the-real-device-secret' });
    if (g.status === 200) { check('sign-up retry can\'t be used without the phone\'s secret', false); break; }
    if (i === 24) check('sign-up retry can\'t be used without the phone\'s secret', true);
  }
  // an edit the anonymous author sends after the claim (it raced the sign-in) still counts as theirs
  r = await A('/api/sightings', { ...sighting, photo: undefined, ratings: [], nickname: 'Mực Đen', fieldAt: { nickname: Date.now() }, updatedAt: Date.now() });
  check('author edit racing the sign-in is kept', r.status === 200 && r.body.nickname === 'Mực Đen' && !('claimedFrom' in r.body));
  r = await A('/api/sightings', { ...sighting, photo: undefined, ratings: [], nickname: 'Mực', fieldAt: { nickname: Date.now() + 1 }, updatedAt: Date.now() + 1 });
  r = await A('/api/sightings');
  check('anonymous sighting moved to the account', r.body.find(s => s.id === 'sight-0001').userId === mai.user.id);
  const arr = await A('/api/sightings', { ...sighting, id: ['sight-0002'], photo: 'data:image/jpeg;base64,' + jpeg.toString('base64') });
  check('non-text sighting id is rejected', arr.status === 400);
  check('anonymous rating moved to the account', r.body.find(s => s.id === 'sight-0002').ratings[0].userId === mai.user.id);
  check('no internal fields leak', !JSON.stringify(r.body).match(/ownerHash|passHash|"v":/));

  // ---- 3. Two instances at once (Render zero-downtime deploy) ----
  await start(8800, S3ENV);
  const idA = (await A('/api/health')).body.serverId, idB = (await Bx('/api/health')).body.serverId;
  check('both instances report the same server id', !!idA && idA === idB);
  r = await Bx('/api/auth/login', { username: 'mai_test', password: 'pw-123456' });
  check('instance B sees the account created on A', r.status === 200);
  const maiB = r.body.token;
  r = await Bx('/api/auth/register', { username: 'paws_test', password: 'pw-123456' });
  const paws = r.body;
  r = await A('/api/auth/login', { username: 'paws_test', password: 'pw-123456' });
  check('instance A sees the account created on B', r.status === 200);
  // interleaved progress from two phones on two instances
  await Promise.all([
    A('/api/me/progress', { device: 'd-phonea1', dev: { xp: 120, stats: { catches: 3 } }, badges: ['first'] }, mai.token),
    Bx('/api/me/progress', { device: 'd-phoneb2', dev: { xp: 30, stats: { catches: 1 } }, badges: ['five'] }, maiB),
    A('/api/me/progress', { device: 'd-phonea1', dev: { xp: 120, stats: { catches: 3 } } }, mai.token),
  ]);
  r = await Bx('/api/me/progress', { device: 'd-phoneb2', dev: { xp: 30 } }, maiB);
  check('concurrent progress on two instances: nothing lost or doubled', r.body.profile.xp === 150 && r.body.profile.stats.catches === 4 && r.body.profile.badges.length === 2,
    `xp ${r.body.profile.xp}, catches ${r.body.profile.stats.catches}`);
  // concurrent edits to the same sighting from both instances
  const now = Date.now();
  await Promise.all([
    A('/api/sightings', { ...sighting, photo: undefined, userId: mai.user.id, helper: { userId: mai.user.id, name: 'Mai', at: now }, fieldAt: { helper: now }, updatedAt: now }, mai.token),
    Bx('/api/sightings', { ...sighting, photo: undefined, userId: mai.user.id, ratings: [{ userId: paws.user.id, score: 4, at: now }], updatedAt: now }, paws.token),
  ]);
  r = await A('/api/sightings');
  const s1 = r.body.find(s => s.id === 'sight-0001');
  check('concurrent edits on two instances both kept', s1.helper?.userId === mai.user.id && s1.ratings.length === 2);

  // player Helped → unverified; shelter approved by admin (on the other instance) confirms → verified
  r = await A('/api/sightings', { ...sighting, photo: undefined, userId: mai.user.id, resolved: { userId: mai.user.id, at: Date.now(), outcome: 'rescued', verified: true }, updatedAt: Date.now(), fieldAt: { resolved: Date.now() } }, mai.token);
  check('player "Helped" stays unverified', r.body.resolved?.verified === false);
  r = await Bx('/api/shelter/apply', { name: 'Paws Test Shelter ✅', phone: '0901 234 567', area: 'D7' }, paws.token);
  check('shelter application pending, check mark stripped', r.body.shelter?.status === 'pending' && r.body.shelter.name === 'Paws Test Shelter');
  r = await A('/api/admin/users', { userId: paws.user.id, action: 'approve' }, null, admin);
  check('approve without the reviewed application is refused', r.status === 409);
  const appliedAt = (await A('/api/admin/users', undefined, null, admin)).body.find(u => u.id === paws.user.id).shelter.appliedAt;
  r = await A('/api/admin/users', { userId: paws.user.id, action: 'approve', appliedAt }, null, admin);
  check('admin approves the reviewed application', r.body.user?.role === 'shelter');
  await sleep(5);
  const t = Date.now();
  r = await Bx('/api/sightings', { ...sighting, photo: undefined, nickname: 'Hacked', resolved: { userId: 'x', name: 'x', at: t, outcome: 'rescued' }, updatedAt: t, fieldAt: { resolved: t, nickname: t } }, paws.token);
  check('shelter confirmation verified (via the other instance)', r.body.resolved?.verified === true && r.body.resolved.name === 'Paws Test Shelter');
  check('shelter could not change author fields', r.body.nickname === 'Mực' && r.body.userId === mai.user.id);
  const t2 = Date.now() + 1;
  r = await A('/api/sightings', { ...sighting, photo: undefined, ownerKey: 'stale-device-secret-1', actorId: 'u-stale1', resolved: null, helper: null, ratings: [{ userId: 'u-stale1', score: 3, at: t2 }], updatedAt: t2, fieldAt: {} });
  check('stale rating keeps verified Helped', r.body.resolved?.verified === true && r.body.ratings.length === 3);

  // incremental sync
  const before = Number((await A('/api/sightings')).headers.get('X-Server-Time'));
  await sleep(20);
  await A('/api/sightings', { ...sighting, photo: undefined, ownerKey: 'stale-device-secret-1', actorId: 'u-stale1', ratings: [{ userId: 'u-stale1', score: 4, at: Date.now() }], updatedAt: Date.now() });
  r = await Bx(`/api/sightings?since=${before}`);
  check('incremental sync returns only what changed', r.body.length === 1 && r.body[0].id === 'sight-0001');

  // revoked token is an error, not anonymous
  r = await A('/api/sightings', { ...sighting, photo: undefined }, 'f'.repeat(64));
  check('unknown session token → 401', r.status === 401);
  r = await A('/api/sightings', { id: 'ghost-9999', userId: 'u-somebody', lat: 1, lng: 1, ratings: [], actorId: 'u-mephone1', ownerKey: 'me-phone-secret-12345' });
  check('stranger cannot recreate others\' sightings', r.status === 409);

  // rate limits per client behind the proxy; right admin key always works
  for (let i = 0; i < 12; i++) await A('/api/admin/users', {}, null, { 'X-Admin-Key': 'wrong', 'X-Forwarded-For': '9.9.9.9' });
  r = await A('/api/admin/users', {}, null, { 'X-Admin-Key': 'wrong', 'X-Forwarded-For': '9.9.9.9' });
  check('wrong admin keys get rate-limited', r.status === 429);
  r = await A('/api/admin/users', undefined, null, { ...admin, 'X-Forwarded-For': '9.9.9.9' });
  check('right admin key still works from that client', r.status === 200);
  for (let i = 0; i < 21; i++) await A('/api/auth/login', { username: 'nobody', password: 'x' }, null, { 'X-Forwarded-For': '1.1.1.1, 6.6.6.6' });
  r = await A('/api/auth/login', { username: 'mai_test', password: 'pw-123456' }, null, { 'X-Forwarded-For': '1.1.1.1, 7.7.7.7' });
  check('rate limit uses the proxy-appended IP (forged first entry ignored)', r.status === 200);
  r = await A('/api/admin/ip', undefined, null, { ...admin, 'X-Forwarded-For': '1.2.3.4, 5.6.7.8' });
  check('admin IP check shows the trusted client IP', r.body.clientIp === '5.6.7.8');

  // a phone folded into "retired" and coming back is not counted twice
  r = await A('/api/auth/register', { username: 'many_phones', password: 'pw-123456' });
  const many = r.body.token;
  for (let i = 0; i < 51; i++) await A('/api/me/progress', { device: `d-phone${String(i).padStart(3, '0')}`, dev: { xp: 10 } }, many);
  r = await A('/api/me/progress', { device: 'd-phone000', dev: { xp: 10 } }, many);
  check('folded phone coming back is not double-counted', r.body.profile.xp === 510, `xp ${r.body.profile.xp}`);

  // big reward history stays fast
  const big = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`rate:k-${i}-abcdef`, 1]));
  const tt = Date.now();
  for (let i = 0; i < 4; i++) await A('/api/me/progress', { device: 'd-phonea1', dev: { xp: 120 }, rewarded: big }, mai.token);
  check('large reward history merges fast', Date.now() - tt < 3000, `${Date.now() - tt} ms`);

  // ---- 4. Full restart of both: everything persists ----
  await stop(8800); await stop(8799);
  await start(8799, S3ENV);
  const list2 = (await A('/api/sightings')).body;
  check('sightings survive restart', list2.length === 2 && list2.find(s => s.id === 'sight-0001').resolved?.verified === true);
  check('server id survives restart', (await A('/api/health')).body.serverId === idA);
  ph = Buffer.from(await (await fetch('http://localhost:8799/photos/sight-0001.jpg')).arrayBuffer());
  check('photo survives restart', ph.equals(jpeg));
  r = await A('/api/auth/login', { username: 'mai_test', password: 'pw-123456' });
  check('login after restart, progress kept', r.status === 200 && r.body.user.profile.xp === 150);
  r = await A('/api/me/progress', { device: 'd-phonea1', dev: { xp: 120 } }, mai.token);
  check('old session still valid after restart', r.status === 200);
  const code = retry.body.recoveryCode.toLowerCase().replace(/-/g, '');
  const both = await Promise.all([
    A('/api/auth/recover', { username: 'mai_test', recoveryCode: code, password: 'pw-new-999' }),
    A('/api/auth/recover', { username: 'mai_test', recoveryCode: code, password: 'pw-other-999' }),
  ]);
  check('recovery code works once (lowercase, no dashes), even when used twice at once',
    both.filter(x => x.status === 200).length === 1 && both.some(x => x.status === 200 && x.body.recoveryCode), both.map(x => x.status).join('/'));
  r = both.find(x => x.status === 200);
  r = await A('/api/me/progress', { device: 'd-phonea1', dev: { xp: 120 } }, mai.token);
  check('recovery signs out other sessions', r.status === 401);
  r = await A('/api/auth/register', { username: 'MAI_TEST', password: 'pw-123456' });
  check('usernames unique (case-insensitive)', r.status === 409);
  await stop(8799);

  // ---- 5. On Render without MONGODB_URI the server refuses to start ----
  const { MONGODB_URI, ...noMongo } = baseEnv;
  const res = spawnSync('node', ['server/server.js'], { cwd: PROJECT, env: { ...noMongo, RENDER: 'true', PORT: '8801' }, timeout: 15000, encoding: 'utf8' });
  check('refuses file storage on Render', res.status === 1 && /MONGODB_URI is not set/.test(res.stderr));
  const bad = spawnSync('node', ['server/server.js'], { cwd: PROJECT, env: { ...baseEnv, ...S3ENV, PHOTOS_S3_BUCKET: 'no-such-bucket', PORT: '8802' }, timeout: 20000, encoding: 'utf8' });
  check('misconfigured photo bucket fails at boot', bad.status !== 0 && /not reachable/.test(bad.stderr));
} catch (e) {
  failures++;
  console.error('💥', e);
} finally {
  await stop(8800).catch(() => {}); await stop(8799).catch(() => {});
  await s3.close();
  await mongo.stop();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

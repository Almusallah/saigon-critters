// Where the community server keeps its data.
//
// - Production (Render etc.): MongoDB is the single source of truth (MONGODB_URI). Nothing is cached
//   between requests, and every write is a version-checked update, so two server instances, e.g. the
//   old and new one during a zero-downtime deploy, can never overwrite each other. Photos go to an
//   S3-compatible bucket (Backblaze B2, R2, S3) when PHOTOS_S3_BUCKET is set, otherwise into MongoDB.
// - Local development: JSON files in DATA_DIR (default ./data). One process, no dependencies.
//
// Every record carries a version `v`. update*(doc, v) succeeds only if the stored version is still v;
// callers re-read and retry on conflict (see mutate() in server.js).

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const SCHEMA_VERSION = 2;

export async function openStorage({ dataDir, mongoUri, dbName, s3 }) {
  const store = mongoUri ? await openMongo(mongoUri, dbName) : openFiles(dataDir);
  if (s3?.bucket) {
    const bucket = await openBucket(s3);
    const fallback = store.readPhoto;
    store.savePhoto = bucket.save;
    // Photos saved before the bucket was configured are still readable from the old place.
    store.readPhoto = async id => (await bucket.read(id)) || fallback(id);
    store.kind += '+s3';
  }
  return store;
}

// ---------- MongoDB ----------

async function openMongo(uri, dbName) {
  let MongoClient;
  try { ({ MongoClient } = await import('mongodb')); }
  catch { throw new Error('MONGODB_URI is set but the "mongodb" package is missing: run npm install'); }
  const client = new MongoClient(uri, { appName: 'saigon-critters', serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(dbName);
  const S = db.collection('sightings'), U = db.collection('users'), P = db.collection('photos');
  const A = db.collection('anon'), M = db.collection('meta');
  await Promise.all([
    U.createIndex({ username: 1 }, { unique: true }),
    U.createIndex({ tokens: 1 }),
    S.createIndex({ userId: 1 }),
    S.createIndex({ 'ratings.userId': 1 }),
    S.createIndex({ serverAt: 1 }),
    S.createIndex({ 'helper.userId': 1 }),
    S.createIndex({ 'resolved.userId': 1 }),
  ]);
  await M.updateOne({ _id: 'schema' }, { $max: { version: SCHEMA_VERSION } }, { upsert: true });
  // A stable id for this community (survives restarts and redeploys; same for every address it's reached by).
  await M.updateOne({ _id: 'server' }, { $setOnInsert: { serverId: 'srv-' + randomBytes(9).toString('hex') } }, { upsert: true });
  const serverIdValue = (await M.findOne({ _id: 'server' })).serverId;

  const strip = doc => { if (!doc) return null; const { _id, ...rest } = doc; return rest; };
  const isDup = e => e?.code === 11000;
  const versionFilter = (id, v) => (v ? { _id: id, v } : { _id: id, $or: [{ v: 0 }, { v: { $exists: false } }] });

  async function insert(col, doc) {
    try { await col.insertOne({ _id: doc.id, ...doc, v: 1 }); doc.v = 1; return true; }
    catch (e) { if (isDup(e)) return false; throw e; }
  }
  async function update(col, doc, v) {
    const next = { ...doc, v: (v || 0) + 1 };
    delete next._id;
    const r = await col.replaceOne(versionFilter(doc.id, v), next);
    if (r.matchedCount === 1) { doc.v = next.v; return true; }
    return false;
  }

  return {
    kind: 'mongodb',
    serverId: async () => serverIdValue,
    /** Everything, or (incremental sync) only what changed after `since` (server clock, ms). */
    listSightings: async since => (await S.find(since ? { serverAt: { $gt: since } } : {}).toArray()).map(strip),
    getSighting: async id => strip(await S.findOne({ _id: id })),
    insertSighting: doc => insert(S, doc),
    updateSighting: (doc, v) => update(S, doc, v),
    /** ids of sightings that mention this player anywhere (author, rating, helper, resolver). */
    sightingIdsTouching: async userId => (await S.find(
      { $or: [{ userId }, { 'ratings.userId': userId }, { 'helper.userId': userId }, { 'resolved.userId': userId }] },
      { projection: { _id: 1 } },
    ).toArray()).map(d => d._id),

    listUsers: async () => (await U.find({}).toArray()).map(strip),
    getUserById: async id => strip(await U.findOne({ _id: id })),
    getUserByName: async username => strip(await U.findOne({ username })),
    getUserByToken: async tokenHash => strip(await U.findOne({ tokens: tokenHash })),
    insertUser: doc => insert(U, doc),
    updateUser: (doc, v) => update(U, doc, v),

    /** Anonymous players: which device key owns a player id (proved on every anonymous upload). */
    getAnonKey: async id => (await A.findOne({ _id: id }))?.keyHash || null,
    setAnonKey: async (id, keyHash) => {
      try { await A.insertOne({ _id: id, keyHash, at: new Date() }); return true; }
      catch (e) { if (isDup(e)) return false; throw e; }
    },
    deleteAnonKey: id => A.deleteOne({ _id: id }),

    savePhoto: (id, buf) => P.replaceOne({ _id: id }, { _id: id, data: buf, contentType: 'image/jpeg', at: new Date() }, { upsert: true }),
    async readPhoto(id) {
      const doc = await P.findOne({ _id: id });
      return doc ? Buffer.from(doc.data.buffer.subarray(0, doc.data.position)) : null;
    },
    close: () => client.close(),
  };
}

// ---------- S3-compatible bucket (photos) ----------

/** e.g. Backblaze B2: endpoint https://s3.<region>.backblazeb2.com. Checked at boot so a bad config fails the deploy. */
async function openBucket({ endpoint, region, bucket, keyId, secret }) {
  let sdk;
  try { sdk = await import('@aws-sdk/client-s3'); }
  catch { throw new Error('PHOTOS_S3_BUCKET is set but "@aws-sdk/client-s3" is missing: run npm install'); }
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } = sdk;
  const client = new S3Client({
    endpoint,
    region: region || 'us-east-1',
    credentials: { accessKeyId: keyId, secretAccessKey: secret },
    forcePathStyle: true,
  });
  try { await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(10000) }); }
  catch (e) { throw new Error(`Photo bucket "${bucket}" is not reachable (${e.name || e.message}). Check the PHOTOS_S3_* settings.`); }
  const key = id => `photos/${id}.jpg`;
  return {
    // Bounded, so a hung bucket fails the request (the phone retries) instead of holding it open.
    save: (id, buf) => client.send(new PutObjectCommand({ Bucket: bucket, Key: key(id), Body: buf, ContentType: 'image/jpeg' }),
      { abortSignal: AbortSignal.timeout(20000) }),
    async read(id) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key(id) }));
        return Buffer.from(await res.Body.transformToByteArray());
      } catch (e) {
        if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    },
  };
}

// ---------- local JSON files ----------

function openFiles(dir) {
  const photos = join(dir, 'photos');
  mkdirSync(photos, { recursive: true });
  const file = name => join(dir, name);
  const load = (name, fallback) => (existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) : fallback);
  const write = (name, data) => {
    writeFileSync(file(name) + '.tmp', JSON.stringify(data));
    renameSync(file(name) + '.tmp', file(name));
  };
  const sightings = new Map(load('sightings.json', []).map(s => [s.id, s]));
  const users = new Map(load('users.json', []).map(u => [u.id, u]));
  const anon = new Map(Object.entries(load('anon.json', {})));
  if (!existsSync(file('server-id.txt'))) writeFileSync(file('server-id.txt'), 'srv-' + randomBytes(9).toString('hex'));
  const serverIdValue = readFileSync(file('server-id.txt'), 'utf8').trim();
  const saveS = () => write('sightings.json', [...sightings.values()]);
  const saveU = () => write('users.json', [...users.values()]);
  const clone = d => (d ? structuredClone(d) : null);

  function insert(map, doc, save) {
    if (map.has(doc.id)) return false;
    doc.v = 1;
    map.set(doc.id, clone(doc));
    save();
    return true;
  }
  function update(map, doc, v, save) {
    const cur = map.get(doc.id);
    if (!cur || (cur.v || 0) !== (v || 0)) return false;
    doc.v = (v || 0) + 1;
    map.set(doc.id, clone(doc));
    save();
    return true;
  }

  return {
    kind: 'files',
    serverId: async () => serverIdValue,
    listSightings: async since => [...sightings.values()].filter(s => !since || (s.serverAt || 0) > since).map(clone),
    getSighting: async id => clone(sightings.get(id)),
    insertSighting: async doc => insert(sightings, doc, saveS),
    updateSighting: async (doc, v) => update(sightings, doc, v, saveS),
    sightingIdsTouching: async userId => [...sightings.values()]
      .filter(s => s.userId === userId || s.ratings?.some(r => r.userId === userId)
        || s.helper?.userId === userId || s.resolved?.userId === userId)
      .map(s => s.id),

    listUsers: async () => [...users.values()].map(clone),
    getUserById: async id => clone(users.get(id)),
    getUserByName: async username => clone([...users.values()].find(u => u.username === username)),
    getUserByToken: async tokenHash => clone([...users.values()].find(u => u.tokens?.includes(tokenHash))),
    insertUser: async doc => {
      if ([...users.values()].some(u => u.username === doc.username)) return false;
      return insert(users, doc, saveU);
    },
    updateUser: async (doc, v) => update(users, doc, v, saveU),

    getAnonKey: async id => anon.get(id) || null,
    setAnonKey: async (id, keyHash) => {
      if (anon.has(id)) return false;
      anon.set(id, keyHash);
      write('anon.json', Object.fromEntries(anon));
      return true;
    },
    deleteAnonKey: async id => { anon.delete(id); write('anon.json', Object.fromEntries(anon)); },

    savePhoto: async (id, buf) => writeFileSync(join(photos, `${id}.jpg`), buf),
    async readPhoto(id) {
      const p = join(photos, `${id}.jpg`);
      return existsSync(p) ? readFileSync(p) : null;
    },
    close: async () => {},
  };
}

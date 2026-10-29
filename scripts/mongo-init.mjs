// Creates the three collections with validators + indexes (idempotent).
import { MongoClient } from 'mongodb';
import { loadEnv } from './env.mjs';
import { COLLECTIONS } from '../src/lib/mongo-schema.mjs';

const env = loadEnv();
// MONGO_COMPAT_MODE=1 is ONLY for MongoDB-compatible test servers (e.g. FerretDB) that lack some features.
// With real MongoDB leave it unset: any unsupported option is then a hard error instead of being skipped.
const COMPAT = env.MONGO_COMPAT_MODE === '1';
if (COMPAT) console.warn('!! MONGO_COMPAT_MODE=1: unsupported validators / index options will be SKIPPED (test server only)');
const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 4000 });
await client.connect();
const db = client.db(env.MONGODB_DB || 'clubconnect');
const existing = new Set((await db.listCollections().toArray()).map(c => c.name));
for (const [name, spec] of Object.entries(COLLECTIONS)) {
  try {
    if (!existing.has(name)) await db.createCollection(name, { validator: spec.validator, validationAction: 'error' });
    else await db.command({ collMod: name, validator: spec.validator, validationAction: 'error' });
    console.log(`collection ${name}: validator ${existing.has(name) ? 'updated' : 'created'}`);
  } catch (e) {
    if (!COMPAT) throw e;
    console.warn(`collection ${name}: validator NOT applied (${e.message})`);
    if (!existing.has(name)) await db.createCollection(name);
  }
  for (const idx of spec.indexes) {
    const { key, ...opts } = idx;
    try { await db.collection(name).createIndex(key, opts); }
    catch (e) {
      if (!COMPAT || e.code !== 238) throw e;
      const { expireAfterSeconds, ...rest } = opts;
      console.warn(`  index ${opts.name}: option expireAfterSeconds not supported here; created WITHOUT TTL`);
      await db.collection(name).createIndex(key, rest);
    }
  }
  console.log(`collection ${name}: ${spec.indexes.length} indexes ensured`);
}
await client.close();

// Backend penyimpanan: Upstash Redis (Vercel) atau file lokal (laptop/Railway Volume).
// Antarmuka sama: load() -> {db, ver}; commit(db, ver) -> boolean (compare-and-set); proof put/get.
const fs = require("fs");
const path = require("path");

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function createRedisBackend({ url, token }) {
  const DATA = "rimbacamp:db", VER = "rimbacamp:ver";
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  async function call(endpoint, body) {
    const res = await fetch(url.replace(/\/$/, "") + endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("Upstash: " + (json.error || res.status));
    return json;
  }
  const CAS = "local v=tonumber(redis.call('GET',KEYS[2]) or '0') if v==tonumber(ARGV[1]) then redis.call('SET',KEYS[1],ARGV[2]) redis.call('SET',KEYS[2],tostring(v+1)) return 1 else return 0 end";

  return {
    kind: "redis",
    maxProof: 600 * 1024, // batas request Upstash gratis 1 MB (base64 +33%)
    async load() {
      const r = await call("/pipeline", [["GET", DATA], ["GET", VER]]);
      if (r[0].error) throw new Error("Upstash: " + r[0].error);
      return { db: r[0].result ? JSON.parse(r[0].result) : null, ver: Number(r[1].result || 0) };
    },
    async commit(db, ver) {
      const r = await call("", ["EVAL", CAS, "2", DATA, VER, String(ver), JSON.stringify(db)]);
      if (r.error) throw new Error("Upstash: " + r.error);
      return r.result === 1;
    },
    async putProof(code, buf, mime) {
      const r = await call("", ["SET", `rimbacamp:proof:${code}`, buf.toString("base64")]);
      if (r.error) throw new Error("Upstash: " + r.error);
    },
    async getProof(code, mime) {
      const r = await call("", ["GET", `rimbacamp:proof:${code}`]);
      return r.result ? { buf: Buffer.from(r.result, "base64"), mime } : null;
    },
  };
}

function createFileBackend(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const proofDir = path.join(dataDir, "proofs");
  fs.mkdirSync(proofDir, { recursive: true });
  const file = path.join(dataDir, "db.json");
  let ver = 0; // penjaga race antar-request dalam satu proses

  return {
    kind: "file",
    dataDir,
    maxProof: 4 * 1024 * 1024,
    async load() {
      return { db: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null, ver };
    },
    async commit(db, expected) {
      if (expected !== ver) return false;
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, file);
      ver += 1;
      return true;
    },
    async putProof(code, buf, mime) {
      for (const e of Object.values(EXT)) fs.rmSync(path.join(proofDir, `${code}.${e}`), { force: true });
      fs.writeFileSync(path.join(proofDir, `${code}.${EXT[mime]}`), buf);
    },
    async getProof(code, mime) {
      const f = path.join(proofDir, `${code}.${EXT[mime]}`);
      return fs.existsSync(f) ? { buf: fs.readFileSync(f), mime } : null;
    },
  };
}

function createBackend(config) {
  if (config.redis.url && config.redis.token) return createRedisBackend(config.redis);
  return createFileBackend(config.dataDir);
}

module.exports = { createBackend };

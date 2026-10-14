// RimbaCamp - handler HTTP per-request. Dipakai server lokal/Railway (server/index.js) dan Vercel (api/[...path].js).
const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/env");
const { createBackend } = require("./lib/backend");
const { openStore } = require("./lib/store");
const { createOrderService, HttpError } = require("./lib/orders");
const { createAuth } = require("./lib/auth");

const config = loadEnv();
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const products = require("../public/data/products.json"); // require statis agar ikut terbundel di Vercel

if (config.isProduction) {
  const missing = [];
  if (config.admin.password.length < 12) missing.push(`ADMIN_PASSWORD (min. 12 karakter, sekarang ${config.admin.password.length})`);
  if (!config.admin.sessionSecret) missing.push("SESSION_SECRET (kosong)");
  if (config.onVercel && !(config.redis.url && config.redis.token)) missing.push("KV_REST_API_URL / KV_REST_API_TOKEN (hubungkan database Upstash Redis di Vercel: Storage)");
  if (missing.length) {
    console.error("Mode produksi, tetapi variabel berikut belum benar: " + missing.join("; "));
    console.error("Isi di dashboard hosting (Vercel: Settings -> Environment Variables) lalu redeploy.");
    process.exit(1);
  }
}

const backend = createBackend(config);
const auth = createAuth({ ...config.admin, isProduction: config.isProduction });

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

// ---------- helper ----------
function send(res, status, body, headers = {}) {
  const isObj = typeof body === "object" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

// IP klien: Vercel memberi x-vercel-forwarded-for; di proxy lain entri TERAKHIR X-Forwarded-For dipasang proxy.
const clientIp = (req) => {
  if (req.headers["x-vercel-forwarded-for"]) return String(req.headers["x-vercel-forwarded-for"]).split(",")[0].trim();
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
  return config.isProduction && xff.length ? xff[xff.length - 1] : req.socket.remoteAddress;
};

/** Baca body mentah sekali (Vercel bisa sudah mem-parsing lewat req.body). */
async function readBody(req, limit) {
  const pre = req.body; // di Vercel getter ini mem-parsing body; lokal undefined
  if (pre !== undefined && pre !== null) {
    if (Buffer.isBuffer(pre)) return pre;
    if (typeof pre === "string") return Buffer.from(pre);
    return Buffer.from(JSON.stringify(pre));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, "Payload terlalu besar")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------- rute ----------
// [method, pola, handler({orders, store, ...}), perluAdmin]
const routes = [];
const route = (method, pattern, handler, admin = false) =>
  routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), handler, admin });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Publik
route("GET", "/api/health", async () => ({ ok: true }));

route("GET", "/api/config", async ({ orders, store }) => ({
  paymentEnabled: orders.bankReady(),
  bankAccount: store.settings.bankAccount,
  holdMinutes: config.holdMinutes,
  slotCapacity: orders.SLOT_CAPACITY,
  maxProofKb: Math.round(store.maxProof / 1024),
}));

route("GET", "/api/availability", async ({ orders, query }) => {
  const { startDate, endDate } = query;
  if (!DATE_RE.test(startDate || "") || !DATE_RE.test(endDate || "") || endDate < startDate) throw new HttpError(400, "Rentang tanggal tidak valid");
  orders.expireStale();
  return Object.fromEntries(products.map((p) => [p.id, orders.available(p, startDate, endDate)]));
});

route("GET", "/api/slots", async ({ orders, query }) => {
  if (!DATE_RE.test(query.date || "")) throw new HttpError(400, "Tanggal tidak valid");
  orders.expireStale();
  return { date: query.date, slots: orders.slotsFor(query.date) };
});

route("POST", "/api/orders", async ({ orders, json }) => {
  const o = await orders.createOrder(json());
  return { status: 201, data: orders.publicView(o) };
});

route("GET", "/api/orders/:code", async ({ orders, params }) => {
  orders.expireStale();
  const o = orders.find(params.code);
  if (!o) throw new HttpError(404, "Pesanan tidak ditemukan");
  return orders.publicView(o);
});

// Unggah bukti transfer: body = file gambar mentah (bukan JSON).
route("POST", "/api/orders/:code/proof", async ({ orders, params, body }) => {
  const o = orders.find(params.code);
  if (!o) throw new HttpError(404, "Pesanan tidak ditemukan");
  return orders.publicView(await orders.uploadProof(o, body));
});

// Admin
route("POST", "/api/admin/login", async ({ json, ip }) => {
  const b = json();
  const r = auth.login(b.email, b.password, ip);
  if (r.error) throw new HttpError(r.status, r.error);
  return { status: 200, data: { ok: true }, headers: { "Set-Cookie": r.cookie } };
});
route("POST", "/api/admin/logout", async () => ({ status: 200, data: { ok: true }, headers: { "Set-Cookie": auth.logoutCookie() } }));
route("GET", "/api/admin/me", async ({ session }) => session, true);
route("GET", "/api/admin/summary", async ({ orders }) => orders.summary(), true);
const allOrders = async ({ orders, store }) => { orders.expireStale(); return store.orders.slice().reverse().map(orders.adminView); };
route("GET", "/api/admin/orders", allOrders, true);
route("GET", "/api/admin/payments", allOrders, true);
route("GET", "/api/admin/orders/:code/proof", async ({ orders, params }) => {
  const o = orders.find(params.code);
  const f = o && (await orders.getProof(o));
  if (!f) throw new HttpError(404, "Bukti transfer tidak ada");
  return { file: f };
}, true);
route("POST", "/api/admin/orders/:code/verify", async ({ orders, params, json, session }) => {
  const o = orders.find(params.code);
  if (!o) throw new HttpError(404, "Pesanan tidak ditemukan");
  const b = json();
  orders.adminVerify(o, b.approve === true, session.email, b.reason);
  return orders.adminView(o);
}, true);
route("PATCH", "/api/admin/orders/:code/status", async ({ orders, params, json, session }) => {
  const o = orders.find(params.code);
  if (!o) throw new HttpError(404, "Pesanan tidak ditemukan");
  orders.adminSetStatus(o, json().status, session.email);
  return orders.adminView(o);
}, true);
route("GET", "/api/admin/payment-settings", async ({ orders, store }) => ({ bankAccount: store.settings.bankAccount, paymentEnabled: orders.bankReady() }), true);
route("PUT", "/api/admin/payment-settings", async ({ store, json }) => {
  const body = json();
  const clean = (v, max) => String(v ?? "").trim().slice(0, max);
  const acc = { bankName: clean(body.bankName, 40), accountNumber: clean(body.accountNumber, 30).replace(/[^\d\s-]/g, ""), accountHolder: clean(body.accountHolder, 60) };
  if (!acc.bankName || acc.accountNumber.replace(/\D/g, "").length < 5 || !acc.accountHolder)
    throw new HttpError(400, "Nama bank, nomor rekening (min. 5 digit), dan nama pemilik wajib diisi");
  store.settings.bankAccount = acc;
  store.save();
  return { bankAccount: acc, paymentEnabled: true };
}, true);
route("GET", "/api/admin/stock", async ({ orders, query }) => {
  orders.expireStale();
  const from = DATE_RE.test(query.from || "") ? query.from : orders.todayJakarta();
  return orders.stockGrid(from, 7);
}, true);
route("GET", "/api/admin/products", async () => products, true);

// ---------- penanganan request ----------
async function handleApi(req, res, url) {
  const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
  if (!match) {
    if (routes.some((r) => r.re.test(url.pathname))) return send(res, 405, { error: "Method tidak diizinkan" });
    return send(res, 404, { error: "Endpoint tidak ditemukan" });
  }
  const session = auth.verify(req.headers.cookie);
  if (match.admin && !session) return send(res, 401, { error: "Perlu login admin" });

  // Perlindungan CSRF: request admin yang mengubah data wajib same-origin
  if (req.method !== "GET" && url.pathname.startsWith("/api/admin/")) {
    const origin = req.headers.origin;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    if (origin && new URL(origin).host !== host) return send(res, 403, { error: "Origin tidak diizinkan" });
  }

  const params = match.re.exec(url.pathname).groups || {};
  const isProof = req.method === "POST" && /\/proof$/.test(url.pathname) && !match.admin;
  const hasBody = ["POST", "PUT", "PATCH"].includes(req.method);
  const body = hasBody ? await readBody(req, isProof ? 5 * 1024 * 1024 : 100 * 1024) : Buffer.alloc(0);
  const json = () => {
    if (!body.length) return {};
    try { return JSON.parse(body.toString("utf8")); } catch { throw new HttpError(400, "JSON tidak valid"); }
  };

  // Optimistic lock: bila request lain menyimpan lebih dulu, ulangi dengan data terbaru.
  for (let attempt = 0; attempt < 5; attempt++) {
    const store = await openStore(backend, config.bank);
    const orders = createOrderService({ store, products, config });
    const out = await match.handler({ params, query: Object.fromEntries(url.searchParams), body, json, session, ip: clientIp(req), orders, store });
    if (!(await store.commit())) continue;
    if (out && out.file) {
      res.writeHead(200, { "Content-Type": out.file.mime, "Cache-Control": "private, no-store", "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'" });
      return res.end(out.file.buf);
    }
    if (out && out.data !== undefined) return send(res, out.status || 200, out.data, out.headers);
    return send(res, 200, out ?? {});
  }
  return send(res, 503, { error: "Server sedang sibuk, coba lagi sebentar." });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  let file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, "Forbidden");
  if (!path.extname(file) && fs.existsSync(file + ".html")) file += ".html"; // /katalog -> katalog.html
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "Halaman tidak ditemukan");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": path.extname(file) === ".html" ? "no-cache" : "public, max-age=300",
    });
    fs.createReadStream(file).pipe(res);
  });
}

async function handle(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method tidak diizinkan");
    return serveStatic(req, res, url);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    return send(res, 500, { error: "Terjadi kesalahan pada server" });
  }
}

module.exports = { handle, config, backend, auth };

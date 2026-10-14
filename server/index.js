// Server lokal / Railway (Node biasa). Di Vercel dipakai api/[...path].js.
const http = require("http");
const { handle, config, backend, auth } = require("./app");

http.createServer(handle).listen(config.port, "0.0.0.0", () => {
  console.log(`RimbaCamp berjalan di port ${config.port}`);
  console.log(backend.kind === "redis" ? "Penyimpanan: Upstash Redis" : `Penyimpanan: file di ${backend.dataDir}`);
  if (!auth.enabled) console.log("Admin: ADMIN_PASSWORD belum diisi - login admin dinonaktifkan");
  if (!config.identityKey) console.log("Peringatan: IDENTITY_ENCRYPTION_KEY kosong - nomor identitas penuh TIDAK disimpan (hanya 4 digit terakhir)");
});

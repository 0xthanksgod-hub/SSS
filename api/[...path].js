// Fungsi serverless Vercel: semua /api/* ditangani handler yang sama dengan server lokal.
const { handle } = require("../server/app");
module.exports = (req, res) => handle(req, res);

/* Bagian pembayaran transfer manual yang dipakai wizard booking dan halaman Pesanan Saya. */
RC.pay = (() => {
  const { icon, esc, rupiah } = RC;

  /** Kotak rekening tujuan transfer. */
  const bankBox = (cfg, total) => {
    const b = cfg.bankAccount || {};
    return `<div class="va-box">
      <span>Transfer ke ${esc(b.bankName)}</span>
      <strong>${esc(b.accountNumber)}</strong>
      <small>a.n. <b>${esc(b.accountHolder)}</b></small>
      <button type="button" class="outline-button" data-act="copy" data-copy="${esc((b.accountNumber || "").replace(/\D/g, ""))}">${icon("copy", 16)} Salin nomor rekening</button>
      ${total != null ? `<small>Nominal tepat: <b>${rupiah(total)}</b></small>` : ""}
    </div>`;
  };

  /** Bagian aksi sesuai status pembayaran order. */
  const actions = (o, cfg) => {
    const p = o.payment;
    if (p.status === "PROOF_UPLOADED") {
      return `<div class="notice">${icon("hourglass", 15)} Bukti transfer sudah diterima${p.proofUploadedAt ? ` (${RC.fmtDateTime(p.proofUploadedAt)})` : ""}. Admin akan memverifikasi, biasanya dalam jam buka toko. Stok kamu tetap ditahan.</div>`;
    }
    return `${p.status === "REJECTED" ? `<div class="notice danger">Bukti sebelumnya ditolak: ${esc(p.rejectReason || "tidak sesuai")}. Silakan unggah ulang.</div>` : ""}
      ${bankBox(cfg, o.total)}
      <form class="proof-form" data-code="${esc(o.code)}">
        <label class="proof-pick">${icon("upload", 18)} <span>Pilih foto bukti transfer</span>
          <input type="file" name="proof" accept="image/jpeg,image/png,image/webp" required /></label>
        <button class="secondary-button" type="submit">Kirim bukti transfer</button>
        <small class="hint">Foto JPG/PNG/WEBP, otomatis dikecilkan. Pastikan nominal dan tanggal terlihat jelas.</small>
      </form>`;
  };

  const TARGET = 480 * 1024; // server (Upstash) membatasi ~600 KB, jadi foto dikecilkan dulu di browser

  /** Kecilkan foto ke JPEG <= TARGET. Foto yang sudah kecil dikirim apa adanya. */
  async function shrink(file) {
    if (file.size <= TARGET && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    let bmp;
    try { bmp = await createImageBitmap(file); } catch { throw new Error("Foto tidak bisa dibaca. Gunakan JPG, PNG, atau WEBP (bisa lewat screenshot)."); }
    for (const maxSide of [1600, 1280, 1000, 800]) {
      const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      for (const q of [0.82, 0.7, 0.55]) {
        const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
        if (blob && blob.size <= TARGET) return blob;
      }
    }
    throw new Error("Foto terlalu besar untuk dikecilkan. Coba screenshot bukti transfer.");
  }

  /** Pasang di container; onDone dipanggil dengan order terbaru setelah unggah berhasil. */
  const bind = (root, onDone) => {
    root.addEventListener("change", (e) => {
      const f = e.target.closest(".proof-pick input");
      if (f) f.closest(".proof-pick").querySelector("span").textContent = f.files[0]?.name || "Pilih foto bukti transfer";
    });
    root.addEventListener("submit", async (e) => {
      const form = e.target.closest(".proof-form");
      if (!form) return;
      e.preventDefault();
      const file = form.proof.files[0];
      if (!file) return RC.toast("Pilih foto bukti transfer dulu.", "error");
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true; btn.textContent = "Mengirim…";
      try {
        const out = await shrink(file);
        const res = await fetch(`/api/orders/${encodeURIComponent(form.dataset.code)}/proof`, { method: "POST", headers: { "Content-Type": out.type || "application/octet-stream" }, body: out });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Gagal mengirim bukti");
        RC.toast("Bukti terkirim. Menunggu verifikasi admin.", "success");
        onDone(data);
      } catch (err) {
        RC.toast(err.message, "error");
        btn.disabled = false; btn.textContent = "Kirim bukti transfer";
      }
    });
  };

  return { bankBox, actions, bind };
})();

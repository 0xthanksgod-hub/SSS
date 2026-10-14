// Store per-request: salin state dari backend, ubah di memori, simpan sekali di akhir (optimistic lock).
async function openStore(backend, defaultBank = {}) {
  const { db: saved, ver } = await backend.load();
  const bank = { bankName: "", accountNumber: "", accountHolder: "", ...defaultBank };
  const db = saved
    ? { orders: saved.orders || [], settings: { bankAccount: saved.settings?.bankAccount || bank } }
    : { orders: [], settings: { bankAccount: bank } };
  let dirty = false;

  return {
    get orders() { return db.orders; },
    get settings() { return db.settings; },
    maxProof: backend.maxProof,
    putProof: (...a) => backend.putProof(...a),
    getProof: (...a) => backend.getProof(...a),
    save() { dirty = true; },
    /** false = ada request lain yang menyimpan duluan; ulangi request dengan data baru. */
    async commit() { return dirty ? backend.commit(db, ver) : true; },
  };
}

module.exports = { openStore };

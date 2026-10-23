/** Label jenis mutasi stok — dipakai kartu stok, laporan pergerakan, dan export CSV. */
export const MOVEMENT_LABEL: Record<string, string> = {
  INITIAL: "Stok awal",
  RECEIPT: "Penerimaan",
  SALE: "Penjualan",
  RETURN: "Retur / void",
  TRANSFER_OUT: "Transfer keluar",
  TRANSFER_IN: "Transfer masuk",
  ADJUSTMENT: "Penyesuaian",
  OPNAME: "Stok opname",
};

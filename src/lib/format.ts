const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("id-ID");

/** 1250000 → "Rp1.250.000" (tanpa spasi, sesuai DESIGN_SYSTEM §3) */
export const formatRupiah = (value: number | null | undefined) =>
  value == null ? "—" : rupiah.format(value).replace(/\s/g, "");

export const formatNumber = (value: number | null | undefined) => (value == null ? "—" : number.format(value));

export const formatDateTime = (value: string | Date) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export const formatDate = (value: string | Date) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(value));

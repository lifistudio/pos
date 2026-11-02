/**
 * Identitas merek. Tanda: gulungan kertas struk dilihat dari samping (lingkaran + lubang inti) dengan kertas yang
 * menjuntai dan sobekan zigzag; keduanya membentuk huruf "p". Digambar di kisi 64 unit, tebal goresan 12.
 * Sumber aset di public/brand dan favicon: `node scripts/brand/build-logo.mjs`.
 */
export const BRAND = { name: "POS by lifistudio", short: "POS", by: "by lifistudio", owner: "lifistudio" } as const;

export const BRAND_INK = "#101214";
export const BRAND_PAPER = "#F6F2E9";

export const MARK_VIEWBOX = "0 0 64 64";
export const MARK_PATH = "M14 25a18 18 0 1 1 36 0a18 18 0 1 1-36 0ZM26 25a6 6 0 1 0 12 0a6 6 0 1 0-12 0ZM14 25H26V53L23 57L20 53L17 57L14 53Z";

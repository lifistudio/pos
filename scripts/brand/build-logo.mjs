/**
 * Membuat aset merek dari geometri (tanpa font & tanpa dependensi baru): `node scripts/brand/build-logo.mjs`.
 * Hasil: public/brand/*.svg|png dan src/app/favicon.ico. Bentuk tanda = MARK_PATH di src/lib/brand.ts.
 * Huruf "pos" dan "by lifistudio" digambar sendiri dari modul lingkaran + tangkai yang sama dengan tandanya.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));
const brand = readFileSync(path.join(root, "src/lib/brand.ts"), "utf8");
const pick = (name) => brand.match(new RegExp(`${name} = "([^"]+)"`))[1];
const MARK = pick("MARK_PATH");
const INK = pick("BRAND_INK");
const PAPER = pick("BRAND_PAPER");

// ── Huruf kecil monoline: x-tinggi 6, tinggi naik 10; `y` = garis dasar ─────
const GAP = 2.9;
const LETTERS = {
  b: [6, (x, y) => `M${x} ${y - 10}V${y}M${x} ${y - 3}a3 3 0 1 0 6 0a3 3 0 1 0-6 0`],
  y: [6, (x, y) => `M${x} ${y - 6}L${x + 3} ${y}M${x + 6} ${y - 6}L${x + 1.6} ${y + 3}`],
  l: [0, (x, y) => `M${x} ${y - 10}V${y}`],
  i: [0, (x, y) => `M${x} ${y - 6}V${y}M${x} ${y - 9.2}v.01`],
  // f & t: palang masuk dalam lebar huruf agar tidak menyentuh tetangganya.
  f: [3.8, (x, y) => `M${x + 4.2} ${y - 10}h-.6a2 2 0 0 0-2 2V${y}M${x} ${y - 6}H${x + 3.8}`],
  s: [4.8, (x, y) => `M${x + 4.8} ${y - 6}H${x + 1.5}a1.5 1.5 0 0 0 0 3h1.8a1.5 1.5 0 0 1 0 3H${x}`],
  t: [4, (x, y) => `M${x + 1.6} ${y - 9}V${y - 1.5}a1.5 1.5 0 0 0 1.5 1.5h.9M${x} ${y - 6}H${x + 3.6}`],
  u: [5.6, (x, y) => `M${x} ${y - 6}V${y - 2.8}a2.8 2.8 0 0 0 5.6 0V${y - 6}M${x + 5.6} ${y - 2.8}V${y}`],
  d: [6, (x, y) => `M${x + 6} ${y - 10}V${y}M${x} ${y - 3}a3 3 0 1 0 6 0a3 3 0 1 0-6 0`],
  o: [6, (x, y) => `M${x} ${y - 3}a3 3 0 1 0 6 0a3 3 0 1 0-6 0`],
};
function setText(text, x, y) {
  let d = "";
  let cur = x;
  for (const ch of text) {
    if (ch === " ") {
      cur += 3.6;
      continue;
    }
    const [w, draw] = LETTERS[ch];
    d += draw(cur, y);
    cur += w + GAP;
  }
  return { d, end: cur - GAP };
}

// ── Lockup: tanda menjadi "p", disusul "o" (lingkaran sama) dan "s"; keterangan mengisi ruang di samping tangkai ─
const O = "M56 25a18 18 0 1 1 36 0a18 18 0 1 1-36 0ZM68 25a6 6 0 1 0 12 0a6 6 0 1 0-12 0Z";
// "s" lebih tipis dari tangkai: tiga goresan setebal 12 tidak menyisakan ruang dalam pada tinggi huruf 36.
const S = "M127 11.25H109.9a6.875 6.875 0 0 0 0 13.75H118.1a6.875 6.875 0 0 1 0 13.75H101";
const by = setText("by lifistudio", 33, 55.4);

// ── Garis → bentuk: file logo tidak boleh berisi stroke ────────────────────
// Stroke bisa tidak ikut berskala di Figma/Canva/percetakan. Huruf hanya terdiri dari garis lurus & busur lingkaran
// yang saling bersinggungan, dan offset keduanya tetap garis & busur, jadi hasilnya eksak (bukan kurva hasil pendekatan).
const num = (n) => String(+n.toFixed(3));
const pt = ([x, y]) => `${num(x)} ${num(y)}`;

function parseSegments(d) {
  const tokens = d.match(/[MLHVAmlhva]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const subpaths = [];
  let i = 0;
  let cmd = "";
  let cur = [0, 0];
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const base = rel ? cur : [0, 0];
    switch (cmd.toUpperCase()) {
      case "M":
        cur = [base[0] + next(), base[1] + next()];
        subpaths.push([]);
        break;
      case "L":
      case "H":
      case "V": {
        const kind = cmd.toUpperCase();
        const x = kind === "V" ? cur[0] : base[0] + next();
        const y = kind === "H" ? cur[1] : base[1] + next();
        subpaths.at(-1).push({ a: cur, b: [x, y] });
        cur = [x, y];
        break;
      }
      case "A": {
        const r = next();
        next(); // ry = rx: semua busur lingkaran
        next(); // rotasi
        const large = next();
        const sweep = next();
        const b = [base[0] + next(), base[1] + next()];
        const hx = (cur[0] - b[0]) / 2;
        const hy = (cur[1] - b[1]) / 2;
        const k = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, r * r - hx * hx - hy * hy) / (hx * hx + hy * hy));
        const c = [(cur[0] + b[0]) / 2 + k * hy, (cur[1] + b[1]) / 2 - k * hx];
        subpaths.at(-1).push({ a: cur, b, r, large, sweep, c });
        cur = b;
        break;
      }
    }
  }
  return subpaths;
}

/** Normal kiri arah jalan (sumbu y ke bawah) di titik `p` pada segmen. */
function normalAt(seg, p) {
  if (seg.r) {
    const l = Math.hypot(p[0] - seg.c[0], p[1] - seg.c[1]);
    const radial = [(p[0] - seg.c[0]) / l, (p[1] - seg.c[1]) / l];
    return seg.sweep ? radial : [-radial[0], -radial[1]];
  }
  const l = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
  return [(seg.b[1] - seg.a[1]) / l, -(seg.b[0] - seg.a[0]) / l];
}
const shift = (p, n, d) => [p[0] + n[0] * d, p[1] + n[1] * d];

/** Satu kontur searah jarum jam: sisi kiri maju, ujung, sisi kanan mundur, ujung. Tumpang tindih tetap menyatu (nonzero). */
function outlineStroke(d, width, cap) {
  const h_ = width / 2;
  const end = (to) => (cap === "round" ? `A${h_} ${h_} 0 0 1 ${pt(to)}` : `L${pt(to)}`);
  return parseSegments(d)
    .filter((segs) => segs.length)
    .map((segs) => {
      segs.forEach((seg, i) => {
        const prev = segs[i - 1];
        if (!prev) return;
        const [p, q] = [normalAt(prev, prev.b), normalAt(seg, seg.a)];
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) throw new Error(`sambungan tidak bersinggungan di ${seg.a}`);
      });
      const first = segs[0];
      const last = segs.at(-1);
      let out = `M${pt(shift(first.a, normalAt(first, first.a), h_))}`;
      for (const seg of segs) {
        const to = shift(seg.b, normalAt(seg, seg.b), h_);
        if (seg.r) {
          const radius = seg.r + (seg.sweep ? h_ : -h_);
          out += `A${num(radius)} ${num(radius)} 0 ${seg.large} ${seg.sweep} ${pt(to)}`;
        } else out += `L${pt(to)}`;
      }
      out += end(shift(last.b, normalAt(last, last.b), -h_));
      for (const seg of [...segs].reverse()) {
        const to = shift(seg.a, normalAt(seg, seg.a), -h_);
        if (seg.r) {
          const radius = seg.r + (seg.sweep ? -h_ : h_);
          out += `A${num(radius)} ${num(radius)} 0 ${seg.large} ${seg.sweep ? 0 : 1} ${pt(to)}`;
        } else out += `L${pt(to)}`;
      }
      return `${out}${end(shift(first.a, normalAt(first, first.a), h_))}Z`;
    })
    .join("");
}

const LOCKUP_PATH = [MARK, O, outlineStroke(S, 8.5, "butt"), outlineStroke(by.d, 1.5, "round")].join("");
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const title = "<title>POS by lifistudio</title>";
const lockupBody = (color) => `<path fill="${color}" d="${LOCKUP_PATH}"/>`;
const lockup = (color) => `<svg ${NS} viewBox="10 3 122 58" role="img">${title}${lockupBody(color)}</svg>\n`;
const mark = (color) => `<svg ${NS} viewBox="0 0 64 64" role="img">${title}<path fill="${color}" d="${MARK}"/></svg>\n`;
const tileOf = (bg, fg) => `<svg ${NS} viewBox="0 0 64 64" role="img">${title}<rect width="64" height="64" rx="14" fill="${bg}"/><path fill="${fg}" transform="translate(9.6 9.6) scale(.7)" d="${MARK}"/></svg>\n`;
const tile = tileOf(INK, PAPER);
// Lockup 610×290 di tengah kanvas 1280×640 (skala 5).
const social = `<svg ${NS} viewBox="0 0 1280 640" role="img">${title}<rect width="1280" height="640" fill="${INK}"/><g transform="translate(335 175) scale(5) translate(-10 -3)">${lockupBody(PAPER)}</g></svg>\n`;

const out = path.join(root, "public/brand");
mkdirSync(out, { recursive: true });
const assets = {
  "logo-mark.svg": mark(INK),
  "logo-mark-light.svg": mark(PAPER),
  "logo-tile.svg": tile,
  "logo-tile-light.svg": tileOf(PAPER, INK),
  "logo-lockup.svg": lockup(INK),
  "logo-lockup-light.svg": lockup(PAPER),
  "social-preview.svg": social,
};
for (const [name, svg] of Object.entries(assets)) {
  if (svg.includes("stroke")) throw new Error(`${name} masih berisi stroke`);
  writeFileSync(path.join(out, name), svg);
}

// ── Raster lewat renderer yang sudah dibawa Next (tanpa package baru) ───────
const { createElement: h } = await import(pathToFileURL(require.resolve("react")).href).then((m) => m.default ?? m);
const { ImageResponse } = await import(pathToFileURL(require.resolve("next/dist/compiled/@vercel/og/index.node.js")).href);
const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const png = async (width, height, element) => Buffer.from(await new ImageResponse(element, { width, height }).arrayBuffer());
const box = (w, h_, style, child) => h("div", { style: { width: w, height: h_, display: "flex", alignItems: "center", justifyContent: "center", ...style } }, child);

const sized = (svg, width, height) => svg.replace("<svg ", `<svg width="${width}" height="${height}" `);
const tilePng = (size) => png(size, size, box(size, size, {}, h("img", { src: dataUri(sized(tile, size, size)), width: size, height: size })));
writeFileSync(path.join(out, "logo-512.png"), await tilePng(512));
// Pratinjau repositori GitHub (Settings › Social preview).
writeFileSync(
  path.join(out, "social-preview.png"),
  await png(1280, 640, box(1280, 640, { background: INK }, h("img", { src: dataUri(sized(lockup(PAPER), 610, 290)), width: 610, height: 290 }))),
);

// favicon.ico: wadah ICO berisi PNG 16/32/48.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(tilePng));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const at = 6 + 16 * i;
  header[at] = size;
  header[at + 1] = size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(images[i].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += images[i].length;
});
writeFileSync(path.join(root, "src/app/favicon.ico"), Buffer.concat([header, ...images]));
console.log("aset merek dibuat di public/brand dan src/app/favicon.ico");

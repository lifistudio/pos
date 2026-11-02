import { ImageResponse } from "next/og";
import { BRAND_INK, BRAND_PAPER, MARK_PATH, MARK_VIEWBOX } from "@/lib/brand";

/** Ikon PWA dari tanda merek. Path berekstensi agar tidak melewati proxy login. */
const SIZES: Record<string, { size: number; maskable: boolean }> = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "maskable-512.png": { size: 512, maskable: true },
  "apple-touch-icon.png": { size: 180, maskable: true },
};

export async function GET(_req: Request, ctx: RouteContext<"/icons/[file]">) {
  const { file } = await ctx.params;
  const spec = SIZES[file];
  if (!spec) return new Response("Not found", { status: 404 });
  const { size, maskable } = spec;
  // Maskable: latar penuh + ikon dalam zona aman 60%; biasa: sudut membulat.
  const glyph = Math.round(size * (maskable ? 0.58 : 0.72));
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_INK,
          borderRadius: maskable ? 0 : Math.round(size * 0.22),
        }}
      >
        <svg width={glyph} height={glyph} viewBox={MARK_VIEWBOX} fill={BRAND_PAPER}>
          <path d={MARK_PATH} />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=604800, immutable" } },
  );
}

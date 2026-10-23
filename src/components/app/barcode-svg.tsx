import { encodeBarcode } from "@/lib/barcode";

/**
 * Barcode sebagai SVG hitam di atas putih (bukan token tema — untuk dicetak/di-scan).
 * Lebar mengikuti wadah; quiet zone 10 modul di kiri-kanan.
 */
export function BarcodeSvg({ code, height = 40, showText = true, className }: { code: string; height?: number; showText?: boolean; className?: string }) {
  let barcode: ReturnType<typeof encodeBarcode>;
  try {
    barcode = encodeBarcode(code);
  } catch {
    return <span className="text-caption-1-regular text-text-error-primary">Kode tidak bisa dibuat barcode</span>;
  }
  const quiet = 10;
  const width = barcode.modules.length + quiet * 2;
  const textHeight = showText ? 11 : 0;
  const bars: { x: number; w: number }[] = [];
  for (let i = 0; i < barcode.modules.length; i++) {
    if (barcode.modules[i] !== "1") continue;
    const start = i;
    while (barcode.modules[i + 1] === "1") i++;
    bars.push({ x: start + quiet, w: i - start + 1 });
  }
  return (
    <svg
      viewBox={`0 0 ${width} ${height + textHeight}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Barcode ${barcode.format} ${barcode.text}`}
      className={className}
      shapeRendering="crispEdges"
    >
      <rect width={width} height={height + textHeight} fill="#fff" />
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y={0} width={b.w} height={height} fill="#000" />
      ))}
      {showText && (
        <text x={width / 2} y={height + 9.5} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={9} fill="#000">
          {barcode.text}
        </text>
      )}
    </svg>
  );
}

"use client";

import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { cx } from "@/utils/cx";

/**
 * QR sebagai SVG (satu path) dari string QRIS — tanpa gambar dari server gateway dan tanpa innerHTML.
 * Selalu hitam di atas putih (termasuk mode gelap) agar mudah dipindai kamera.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { size: n, path: d };
  }, [value]);
  const quiet = 4;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}`}
      shapeRendering="crispEdges"
      className={cx("rounded-xl bg-white", className)}
    >
      <rect x={-quiet} y={-quiet} width={size + quiet * 2} height={size + quiet * 2} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

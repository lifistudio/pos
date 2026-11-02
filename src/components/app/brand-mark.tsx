import { BRAND, MARK_PATH, MARK_VIEWBOX } from "@/lib/brand";
import { cx } from "@/utils/cx";

/** Tanda merek: mengikuti warna teks, jadi otomatis benar di tema terang & gelap. */
export function BrandMark({ className, showName = true }: { className?: string; showName?: boolean }) {
  return (
    <span className={cx("flex items-center gap-1.5", className)}>
      <svg viewBox={MARK_VIEWBOX} className="size-8 shrink-0 text-text-primary" fill="currentColor" role={showName ? undefined : "img"} aria-hidden={showName || undefined} aria-label={showName ? undefined : BRAND.name}>
        <path d={MARK_PATH} />
      </svg>
      {showName && (
        <span className="flex flex-col">
          <span className="text-headline-semibold text-text-primary">{BRAND.short}</span>
          <span className="text-caption-1-regular text-text-tertiary">{BRAND.by}</span>
        </span>
      )}
    </span>
  );
}

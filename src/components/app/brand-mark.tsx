import { RiStore2Fill } from "@remixicon/react";
import { cx } from "@/utils/cx";

/** Tanda merek sementara ("Konten") sampai logo resmi tersedia. */
export function BrandMark({ className, showName = true }: { className?: string; showName?: boolean }) {
  return (
    <span className={cx("flex items-center gap-2", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-2lg bg-linear-to-b from-accent-500 to-accent-600 shadow-nav-selected">
        <RiStore2Fill className="size-[18px] text-white" aria-hidden />
      </span>
      {showName && <span className="text-headline-semibold text-text-primary">Konten</span>}
    </span>
  );
}

import { cx } from "@/utils/cx";

/** Batang proporsi di sel tabel — membantu membandingkan baris tanpa grafik terpisah. */
export function Share({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="block h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-background-tertiary-default" aria-hidden>
      <span className="block h-full rounded-full bg-accent-500" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "negative" | "positive" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-2xl bg-background-secondary-default px-4 py-3">
      <span className="text-caption-1-regular text-text-tertiary">{label}</span>
      <span className={cx("truncate text-title-3-semibold tabular-nums", tone === "negative" ? "text-status-rose-text" : tone === "positive" ? "text-status-lime-text" : "text-text-primary")}>
        {value}
      </span>
      {hint && <span className="text-caption-1-regular text-text-tertiary">{hint}</span>}
    </div>
  );
}

/** Angka di sel tabel: rata kanan, tabular, warna sekunder kecuali `strong`. */
export function Num({ children, strong, tone }: { children: React.ReactNode; strong?: boolean; tone?: "negative" | "positive" | "muted" }) {
  return (
    <span
      className={cx(
        "text-body-medium whitespace-nowrap tabular-nums",
        tone === "negative" ? "text-status-rose-text" : tone === "positive" ? "text-status-lime-text" : tone === "muted" ? "text-text-tertiary" : strong ? "text-text-primary" : "text-text-secondary",
      )}
    >
      {children}
    </span>
  );
}

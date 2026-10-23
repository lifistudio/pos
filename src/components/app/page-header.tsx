import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-title-1-medium text-balance text-text-primary">{title}</h1>
        {description && <p className="mt-1 max-w-[65ch] text-body-regular text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Permukaan kartu standar (rounded-2xl, latar sekunder) — sama dengan kartu chart BoardUI. */
export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("flex min-w-0 flex-col rounded-2xl bg-background-secondary-default p-4", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-headline-medium text-text-primary">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-background-tertiary-default", className)} aria-hidden />;
}

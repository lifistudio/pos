import { RiCheckLine } from "@remixicon/react";
import { formatDateTime } from "@/lib/format";
import { cx } from "@/utils/cx";

/** Langkah status dokumen (transfer, order): selesai = centang + waktu; belum = nomor urut. */
export function Timeline({ steps }: { steps: { label: string; at: string | null }[] }) {
  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:gap-0">
      {steps.map((s, i) => (
        <li key={s.label} className="flex flex-1 items-center gap-2">
          <span className={cx("flex size-6 shrink-0 items-center justify-center rounded-full", s.at ? "bg-accent-500 text-white" : "bg-background-tertiary-default text-text-tertiary")}>
            {s.at ? <RiCheckLine className="size-3.5" aria-hidden /> : <span className="text-caption-1-medium">{i + 1}</span>}
          </span>
          <span className="min-w-0">
            <span className={cx("block text-body-2-medium", s.at ? "text-text-primary" : "text-text-tertiary")}>{s.label}</span>
            <span className="block text-caption-1-regular text-text-tertiary">{s.at ? formatDateTime(s.at) : "—"}</span>
          </span>
          {i < steps.length - 1 && <span className="mx-3 hidden h-px flex-1 bg-separator-border sm:block" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

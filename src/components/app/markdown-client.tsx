"use client";

import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

/** Blok kode panduan dengan tombol salin (gaya sama dengan CopyField di pengaturan). */
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-xl bg-background-secondary-default p-3">
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-body-2-regular text-text-primary" aria-label={lang ? `Kode ${lang}` : "Kode"}>
        <code>{code}</code>
      </pre>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        iconOnly
        leadingIcon={copied ? RiCheckLine : RiFileCopyLine}
        aria-label={copied ? "Tersalin" : "Salin kode"}
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      />
    </div>
  );
}

/** Daftar isi dengan penanda bagian yang sedang dibaca. */
export function GuideToc({ items }: { items: { id: string; text: string }[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [items]);
  return (
    <nav aria-label="Isi panduan" className="flex flex-col gap-0.5">
      <p className="mb-2 px-2.5 text-caption-1-medium text-text-tertiary">Di panduan ini</p>
      {items.map((t) => (
        <a
          key={t.id}
          href={`#${t.id}`}
          aria-current={active === t.id ? "location" : undefined}
          className={cx(
            "rounded-lg px-2.5 py-1.5 text-body-2-regular transition-colors",
            active === t.id ? "bg-background-secondary-default text-text-primary" : "text-text-tertiary hover:text-text-secondary",
          )}
        >
          {t.text}
        </a>
      ))}
    </nav>
  );
}

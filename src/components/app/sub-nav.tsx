"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/utils/cx";
import { useSession } from "./session-context";

export type SubNavTab = { href: string; label: string; permission?: string; exact?: boolean };

/** Sub-navigasi modul bergaya underline tab BoardUI; tab tanpa permission disembunyikan. */
export function SubNav({ tabs, label }: { tabs: SubNavTab[]; label: string }) {
  const pathname = usePathname();
  const { can } = useSession();
  const visible = tabs.filter((t) => !t.permission || can(t.permission));
  return (
    <nav aria-label={label} className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none]">
      <div className="flex min-w-max gap-5 border-b border-separator-border">
        {visible.map((t) => {
          const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "-mb-px border-b-2 pb-2.5 text-body-medium whitespace-nowrap transition-colors",
                active ? "border-accent-500 text-text-primary" : "border-transparent text-text-tertiary hover:text-text-secondary",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

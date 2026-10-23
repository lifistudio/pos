import {
  RiArrowRightSLine,
  RiBankCardLine,
  RiBookOpenLine,
  RiCloudLine,
  RiPrinterLine,
  RiRobot2Line,
  RiServerLine,
  RiSettings3Line,
  RiStore2Line,
} from "@remixicon/react";
import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/base/badges/chip";
import { PageHeader } from "@/components/app/page-header";
import { GUIDES, guideTabs, PANDUAN_DESCRIPTION } from "./guides";
import { PanduanNav } from "./panduan-nav";

export const metadata: Metadata = { title: "Panduan" };

const ICON = {
  penggunaan: RiBookOpenLine,
  pembayaran: RiBankCardLine,
  printer: RiPrinterLine,
  marketplace: RiStore2Line,
  mcp: RiRobot2Line,
  cloudinary: RiCloudLine,
  env: RiSettings3Line,
  deploy: RiServerLine,
} as const;

export default function GuidesPage() {
  return (
    <>
      <PageHeader title="Panduan" description={PANDUAN_DESCRIPTION} />
      <PanduanNav tabs={guideTabs()} />
      <ul className="divide-y divide-separator-border overflow-hidden rounded-2xl border border-border-table">
        {GUIDES.map((g) => {
          const Icon = ICON[g.slug];
          return (
            <li key={g.slug}>
              <Link
                href={`/panduan/${g.slug}`}
                className="group flex items-center gap-4 px-4 py-3.5 outline-focus-ring transition-colors hover:bg-background-secondary-hover focus-visible:outline-2 focus-visible:-outline-offset-2"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background-secondary-default text-foreground-icon-secondary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-body-medium text-text-primary">{g.title}</span>
                  <span className="text-body-2-regular text-text-tertiary">{g.description}</span>
                </span>
                <Chip variant="subtle" color="gray" className="hidden shrink-0 sm:inline-flex">
                  {g.audience}
                </Chip>
                <RiArrowRightSLine className="size-5 shrink-0 text-foreground-icon-tertiary transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

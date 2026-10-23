import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Markdown, outline } from "@/components/app/markdown";
import { GuideToc } from "@/components/app/markdown-client";
import { PageHeader, Skeleton } from "@/components/app/page-header";
import { findGuide, guideTabs, PANDUAN_DESCRIPTION, readGuide, resolveGuideLink } from "../guides";
import { PanduanNav } from "../panduan-nav";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const guide = findGuide((await params).slug);
  return { title: guide ? `${guide.title} · Panduan` : "Panduan" };
}

async function Guide({ params }: Params) {
  const guide = findGuide((await params).slug);
  if (!guide) notFound();
  const source = await readGuide(guide);
  const toc = outline(source);

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_240px]">
      <article className="min-w-0 max-w-[76ch]">
        <header className="mb-6 flex flex-col gap-2 border-b border-separator-border pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-title-2-medium text-text-primary">{guide.title}</h2>
            <Chip variant="subtle" color="gray">
              {guide.audience}
            </Chip>
          </div>
          <p className="text-body-regular text-text-secondary">{guide.description}</p>
        </header>
        <Markdown source={source} resolveLink={resolveGuideLink} />
      </article>
      {toc.length > 2 && (
        <aside className="hidden xl:block">
          <div className="sticky top-0">
            <GuideToc items={toc} />
          </div>
        </aside>
      )}
    </div>
  );
}

export default function GuidePage({ params }: Params) {
  return (
    <>
      <PageHeader title="Panduan" description={PANDUAN_DESCRIPTION} />
      <PanduanNav tabs={guideTabs()} />
      <Suspense
        fallback={
          <div className="flex max-w-[76ch] flex-col gap-3">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-40" />
          </div>
        }
      >
        <Guide params={params} />
      </Suspense>
    </>
  );
}

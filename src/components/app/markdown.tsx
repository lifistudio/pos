import { RiInformationLine } from "@remixicon/react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { CodeBlock } from "./markdown-client";

/**
 * Renderer Markdown kecil untuk panduan di /docs. Menghasilkan elemen React (tanpa dangerouslySetInnerHTML),
 * jadi teks apa pun aman ditampilkan. Mendukung subset yang dipakai panduan: judul, paragraf, daftar (bertingkat),
 * tabel, kutipan, blok kode, garis, **tebal**, *miring*, `kode`, dan tautan. Gaya mengikuti pola BoardUI aplikasi:
 * tabel `bui-table` dalam wadah DataTable, blok kode seperti CopyField, tautan accent.
 */

export type ResolveLink = (href: string) => { href: string; external: boolean } | null;

export const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/[`*_[\]()]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

/** Teks polos dari markdown inline (untuk daftar isi). */
export const plainInline = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "");

const LINK = "text-accent-600 underline-offset-2 hover:underline dark:text-accent-400";

function inline(text: string, resolve: ResolveLink, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) {
      out.push(
        <code key={k} className="rounded-md bg-background-tertiary-default px-1.5 py-0.5 font-mono text-[0.875em] text-text-primary">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(
        <strong key={k} className="font-semibold text-text-primary">
          {inline(tok.slice(2, -2), resolve, k)}
        </strong>,
      );
    } else if (m[3]) {
      out.push(<em key={k}>{inline(tok.slice(1, -1), resolve, k)}</em>);
    } else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const target = resolve(href);
      const children = inline(label, resolve, k);
      if (!target) out.push(<Fragment key={k}>{children}</Fragment>);
      else if (target.external)
        out.push(
          <a key={k} href={target.href} target="_blank" rel="noopener noreferrer" className={LINK}>
            {children}
          </a>,
        );
      else
        out.push(
          <Link key={k} href={target.href} className={LINK}>
            {children}
          </Link>,
        );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type ListItem = { text: string; children: ListBlock | null };
type ListBlock = { ordered: boolean; items: ListItem[] };

const LIST_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

/** Daftar bertingkat berdasarkan indentasi. */
function parseList(lines: string[], start: number): { block: ListBlock; next: number } {
  const base = LIST_RE.exec(lines[start])!;
  const indent = base[1].length;
  const block: ListBlock = { ordered: /\d/.test(base[2]), items: [] };
  let i = start;
  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    if (m && m[1].length === indent) {
      block.items.push({ text: m[3], children: null });
      i++;
    } else if (m && m[1].length > indent) {
      const sub = parseList(lines, i);
      block.items[block.items.length - 1].children = sub.block;
      i = sub.next;
    } else if (!m && lines[i].trim() && /^\s+/.test(lines[i]) && block.items.length) {
      // Baris lanjutan item (terindentasi).
      block.items[block.items.length - 1].text += ` ${lines[i].trim()}`;
      i++;
    } else break;
  }
  return { block, next: i };
}

function renderList(block: ListBlock, resolve: ResolveLink, key: string): ReactNode {
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag key={key} className={`flex flex-col gap-1.5 ps-5 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-text-tertiary`}>
      {block.items.map((item, i) => (
        <li key={i} className="ps-1">
          {inline(item.text, resolve, `${key}-${i}`)}
          {item.children && <div className="mt-1.5">{renderList(item.children, resolve, `${key}-${i}-c`)}</div>}
        </li>
      ))}
    </Tag>
  );
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

function blocks(md: string, resolve: ResolveLink, keyPrefix = "b"): ReactNode[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => `${keyPrefix}-${out.length}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      out.push(<CodeBlock key={key()} code={body.join("\n")} lang={fence[1]} />);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const id = headingId(plainInline(h[2]));
      const content = inline(h[2], resolve, key());
      // Judul dokumen (h1) sudah tampil di PageHeader halaman.
      if (level === 2) {
        out.push(
          <h2 key={key()} id={id} className="mt-6 scroll-mt-4 text-title-3-medium text-text-primary first:mt-0">
            {content}
          </h2>,
        );
      } else if (level > 2) {
        out.push(
          <h3 key={key()} id={id} className="mt-2 scroll-mt-4 text-headline-medium text-text-primary">
            {content}
          </h3>,
        );
      }
      i++;
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) {
      i++;
      continue; // pemisah bagian di file .md; di aplikasi jarak antarjudul sudah cukup
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push(
        <aside key={key()} className="flex gap-3 rounded-2xl bg-background-secondary-default px-4 py-3.5 text-body-2-regular text-text-secondary">
          <RiInformationLine className="mt-0.5 size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
          <div className="flex min-w-0 flex-col gap-2 [&_p]:text-body-2-regular">{blocks(body.join("\n"), resolve, key())}</div>
        </aside>,
      );
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      const k = key();
      out.push(
        <div key={k} className="overflow-x-auto rounded-2xl border border-border-table pt-2">
          <table className="bui-table bui-table-sm min-w-[36rem]">
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} scope="col" className="whitespace-normal">
                    {inline(c, resolve, `${k}-h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j} className="align-top !text-body-2-regular text-text-secondary first:text-text-primary">
                      {inline(c, resolve, `${k}-${ri}-${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (LIST_RE.test(line)) {
      const { block, next } = parseList(lines, i);
      out.push(renderList(block, resolve, key()));
      i = next;
      continue;
    }
    // Baris pertama selalu dikonsumsi agar baris yang "mirip" blok (mis. `|` tanpa tabel) tidak membuat loop macet.
    const para: string[] = [lines[i++].trim()];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|-{3,}\s*$)/.test(lines[i]) && !LIST_RE.test(lines[i]) && !lines[i].trim().startsWith("|")) {
      para.push(lines[i++].trim());
    }
    out.push(<p key={key()}>{inline(para.join(" "), resolve, key())}</p>);
  }
  return out;
}

export function Markdown({ source, resolveLink }: { source: string; resolveLink: ResolveLink }) {
  return <div className="flex min-w-0 flex-col gap-4 text-body-regular text-text-secondary">{blocks(source, resolveLink)}</div>;
}

/** Judul tingkat 2 sebagai daftar isi. */
export function outline(source: string) {
  return [...source.matchAll(/^##\s+(.*)$/gm)].map((m) => {
    const text = plainInline(m[1]);
    return { id: headingId(text), text };
  });
}

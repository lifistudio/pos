"use client";

import { RiDeleteBinLine, RiImageAddLine, RiImageLine } from "@remixicon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { resizeImage } from "@/lib/image-resize";
import { cx } from "@/utils/cx";

/**
 * Pilih thumbnail produk: gambar diperkecil di perangkat (≤ 1024 px) lalu diserahkan ke `onPick`.
 * Mode terkendali: `src` = gambar saat ini (URL server atau object URL pratinjau).
 */
export function ThumbnailPicker({
  src,
  alt,
  onPick,
  onRemove,
  busy,
  disabled,
  className,
}: {
  src: string | null;
  alt: string;
  onPick: (image: Blob) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const pending = busy || working;

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    setWorking(true);
    try {
      await onPick(await resizeImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memproses gambar.");
    } finally {
      setWorking(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className={cx("flex items-start gap-4", className)}>
      <div
        className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background-tertiary-default sm:size-28"
        aria-busy={pending}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- thumbnail dari API terautentikasi / object URL pratinjau
          <img src={src} alt={alt} className="size-full object-cover" />
        ) : (
          <RiImageLine className="size-8 text-foreground-icon-quaternary" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-body-2-regular text-text-tertiary">Tampil di kasir dan daftar produk. JPG, PNG, atau WebP; otomatis diperkecil.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="small" variant="secondary" leadingIcon={RiImageAddLine} onClick={() => input.current?.click()} disabled={disabled || pending}>
            {pending ? "Memproses…" : src ? "Ganti gambar" : "Pilih gambar"}
          </Button>
          {src && onRemove && (
            <Button type="button" size="small" variant="ghost" leadingIcon={RiDeleteBinLine} onClick={() => onRemove()} disabled={disabled || pending}>
              Hapus
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-body-2-regular text-text-error-primary">
            {error}
          </p>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => choose(e.target.files?.[0])} />
      </div>
    </div>
  );
}

/** Object URL untuk pratinjau Blob, dilepas otomatis saat berganti/unmount. */
export function useObjectUrl(blob: Blob | null) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

/** Unggah thumbnail ke API (body mentah). */
export async function uploadThumbnail(productId: string, image: Blob) {
  const res = await fetch(`/api/v1/products/${productId}/thumbnail`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": image.type || "image/webp" },
    body: image,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error?.message ?? "Gagal mengunggah gambar.");
  return payload.data as { imageUrl: string };
}

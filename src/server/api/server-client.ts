import "server-only";
import { headers } from "next/headers";
import { connection } from "next/server";
import { ApiClientError, buildQuery } from "@/lib/api-client";
import { app } from "./app";

/**
 * Pemanggil API untuk Server Component (SSR). Request dijalankan in-process lewat `app.request()`
 * dengan cookie user, sehingga tetap melewati middleware auth, RBAC, dan validasi yang sama — tanpa hop jaringan.
 * Komponen yang memakainya membaca runtime data, jadi harus berada di dalam <Suspense>.
 */
export async function apiServer<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  // Selalu data per-request: tandai eksplisit agar prerender (validasi instant navigation) berhenti di sini,
  // bukan lanjut ke kode yang memakai waktu sekarang (sesi Better Auth).
  await connection();
  const incoming = await headers();
  const forward = new Headers();
  for (const key of ["cookie", "user-agent", "x-forwarded-for"]) {
    const value = incoming.get(key);
    if (value) forward.set(key, value);
  }
  const res = await app.request(`/api/v1${path}${buildQuery(query)}`, { headers: forward });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiClientError(res.status, payload?.error?.code ?? "UNKNOWN", payload?.error?.message ?? "Gagal memuat data.");
  }
  return payload as T;
}

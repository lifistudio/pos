"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { I18nProvider } from "react-aria-components";
import { ApiClientError } from "@/lib/api-client";
import { ToastProvider } from "./toast";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, error) => !(error instanceof ApiClientError && error.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {/* Locale Indonesia untuk komponen react-aria/BoardUI (tanggal, kalender, angka). */}
      <I18nProvider locale="id-ID">
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

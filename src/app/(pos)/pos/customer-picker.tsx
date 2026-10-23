"use client";

import { RiSearchLine, RiUserAddLine, RiVipCrown2Line } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { useSession } from "@/components/app/session-context";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { useDebounced } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";
import { CustomerForm, displayPhone } from "@/components/app/customer-form";
import type { PosCustomer } from "./use-quote";

/** Cari customer dengan no. HP / nama / no. member, atau daftarkan baru tanpa meninggalkan kasir. */
export function CustomerPicker({ isOpen, onClose, onPick }: { isOpen: boolean; onClose: () => void; onPick: (c: PosCustomer) => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [registering, setRegistering] = useState(false);
  const term = useDebounced(q.trim(), 250);
  const results = useQuery({
    queryKey: ["pos-customers", term],
    queryFn: () => api<{ data: PosCustomer[] }>("/customers", { query: { q: term, pageSize: 10 } }).then((r) => r.data),
    enabled: isOpen && term.length >= 3,
  });

  const close = () => {
    setQ("");
    setRegistering(false);
    onClose();
  };

  return (
    <Sheet isOpen={isOpen} onClose={close} title={registering ? "Daftarkan customer" : "Pilih customer"} description={registering ? undefined : "Ketik minimal 3 karakter: no. HP, nama, atau no. member."}>
      {registering ? (
        <CustomerForm
          customer={null}
          compact
          onCancel={() => setRegistering(false)}
          onSaved={(c) => {
            toast.show({ status: "success", title: c.isMember ? `Member ${c.memberNo} terdaftar` : "Customer terdaftar" });
            onPick(c);
            close();
          }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <InputBase aria-label="Cari customer" placeholder="0812…, nama, atau M26…" leadingIcon={RiSearchLine} value={q} onChange={(e) => setQ(e.target.value)} autoFocus inputMode="search" />
          {term.length >= 3 && (
            <ul className="flex flex-col divide-y divide-separator-border">
              {results.isPending ? (
                <li className="py-3 text-body-regular text-text-tertiary">Mencari…</li>
              ) : !results.data?.length ? (
                <li className="py-3 text-body-regular text-text-tertiary">Tidak ditemukan.</li>
              ) : (
                results.data.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(c);
                        close();
                      }}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-3 text-start outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-body-medium text-text-primary">{c.name}</span>
                        <span className="text-body-2-regular text-text-tertiary">
                          {displayPhone(c.phone)}
                          {c.memberNo && ` · ${c.memberNo}`}
                        </span>
                      </span>
                      {c.isMember && (
                        <span className="flex shrink-0 items-center gap-1 text-body-2-medium text-status-purple-text">
                          <RiVipCrown2Line className="size-4" aria-hidden />
                          {c.tierName ?? "Member"} · {formatNumber(c.points)} poin
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
          {can("customer:create") && (
            <Button variant="secondary" leadingIcon={RiUserAddLine} onClick={() => setRegistering(true)}>
              Daftarkan customer baru
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

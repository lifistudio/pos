"use client";

import { RiAddLine, RiCloseLine, RiSearchLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  ComboBox as AriaComboBox,
  Input as AriaInput,
  Label as AriaLabel,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  Popover as AriaPopover,
  Text as AriaText,
} from "react-aria-components";
import { MENU_ITEM, MENU_ITEM_ACTIVE, MENU_ITEMS_CONTAINER, MENU_POPOVER_SURFACE } from "@/components/base/dropdown/menu-styles";
import { useDebounced } from "@/hooks/use-url-state";
import { cx } from "@/utils/cx";

export type SearchOption = { id: string; name: string; hint?: string; exact?: boolean };

const CREATE = "__create__";

/**
 * Pilihan master data dengan pencarian ke server (merek, dll.) — komposisi react-aria ComboBox dengan gaya
 * Select/Dropdown BoardUI. Bila `onCreate` diberikan dan tidak ada yang sama persis, muncul baris
 * "Tambah …" sehingga pengguna memilih yang ada dulu (mencegah duplikat/typo) sebelum membuat baru.
 */
export function SearchSelect({
  label,
  value,
  onChange,
  search,
  queryKey,
  onCreate,
  createLabel = "Tambah",
  placeholder = "Cari atau pilih…",
  hint,
  isInvalid,
  isDisabled,
  className,
  size = "md",
}: {
  label: string;
  value: SearchOption | null;
  onChange: (value: SearchOption | null) => void;
  search: (q: string) => Promise<SearchOption[]>;
  queryKey: readonly unknown[];
  onCreate?: (name: string) => Promise<SearchOption>;
  createLabel?: string;
  placeholder?: string;
  hint?: string;
  isInvalid?: boolean;
  isDisabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const [input, setInput] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Saat input sama dengan nilai terpilih, tampilkan semua (bukan hanya yang cocok dengan nama terpilih).
  const term = useDebounced(input.trim() === (value?.name ?? "") ? "" : input.trim(), 250);

  const results = useQuery({
    queryKey: [...queryKey, term],
    queryFn: () => search(term),
    enabled: open && !isDisabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const options = results.data ?? [];
  const typed = input.trim();
  const canCreate = !!onCreate && typed.length > 0 && typed !== value?.name && !options.some((o) => o.exact);
  const items: SearchOption[] = [...options, ...(canCreate ? [{ id: CREATE, name: typed }] : [])];

  async function select(key: string | null) {
    setError(null);
    if (key === null) return;
    if (key === CREATE && onCreate) {
      setCreating(true);
      try {
        const created = await onCreate(typed);
        onChange(created);
        setInput(created.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal menambah data.");
      } finally {
        setCreating(false);
      }
      return;
    }
    const picked = options.find((o) => o.id === key) ?? null;
    onChange(picked);
    setInput(picked?.name ?? "");
  }

  const message = error ?? hint;
  return (
    <AriaComboBox<SearchOption>
      className={cx("flex flex-col gap-1.5", className)}
      inputValue={input}
      onInputChange={(v) => {
        setInput(v);
        if (!v) onChange(null);
      }}
      selectedKey={value?.id ?? null}
      onSelectionChange={(k) => void select(k === null ? null : String(k))}
      items={items}
      menuTrigger="focus"
      onOpenChange={setOpen}
      allowsEmptyCollection
      isDisabled={isDisabled || creating}
      isInvalid={isInvalid || !!error}
    >
      <AriaLabel className="text-body-medium text-text-secondary">{label}</AriaLabel>
      <div
        className={cx(
          "flex items-center gap-1.5 rounded-2lg border bg-background-primary-default shadow-xs transition-colors",
          "focus-within:ring-2 focus-within:ring-border-focus-ring focus-within:ring-offset-2",
          isInvalid || error ? "border-border-error-default" : "border-border-button-default hover:border-border-button-hover",
          size === "sm" ? "px-2 py-1" : "px-2.5 py-2",
        )}
      >
        <RiSearchLine className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
        <AriaInput
          ref={inputRef}
          placeholder={placeholder}
          className={cx("min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-tertiary", size === "sm" ? "text-body-2-medium" : "text-body-medium")}
        />
        {value && !isDisabled && (
          <button
            type="button"
            aria-label={`Kosongkan ${label}`}
            onClick={() => {
              onChange(null);
              setInput("");
              inputRef.current?.focus();
            }}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-icon-tertiary hover:bg-background-secondary-hover"
          >
            <RiCloseLine className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {message && <AriaText slot={error || isInvalid ? "errorMessage" : "description"} className={cx("text-body-2-regular", error || isInvalid ? "text-text-error-primary" : "text-text-tertiary")}>{message}</AriaText>}
      <AriaPopover isNonModal offset={4} className={cx(MENU_POPOVER_SURFACE, "w-(--trigger-width) min-w-56 p-2")}>
        <AriaListBox
          className={cx(MENU_ITEMS_CONTAINER, "max-h-[260px] overflow-auto outline-none")}
          renderEmptyState={() => (
            <p className="px-2 py-2 text-body-2-regular text-text-tertiary">{results.isFetching ? "Mencari…" : typed ? "Tidak ada yang cocok." : "Belum ada data."}</p>
          )}
        >
          {(item: SearchOption) =>
            item.id === CREATE ? (
              <AriaListBoxItem
                id={CREATE}
                textValue={`${createLabel} ${item.name}`}
                className={({ isFocused }) => cx(MENU_ITEM, "text-body-medium text-accent-600", isFocused && MENU_ITEM_ACTIVE)}
              >
                <RiAddLine className="size-4 shrink-0" aria-hidden />
                <span className="truncate">
                  {createLabel} “{item.name}”
                </span>
              </AriaListBoxItem>
            ) : (
              <AriaListBoxItem
                id={item.id}
                textValue={item.name}
                className={({ isFocused, isSelected }) => cx(MENU_ITEM, "text-body-medium", (isFocused || isSelected) && MENU_ITEM_ACTIVE)}
              >
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.hint && <span className="shrink-0 text-caption-1-regular text-text-tertiary">{item.hint}</span>}
              </AriaListBoxItem>
            )
          }
        </AriaListBox>
      </AriaPopover>
    </AriaComboBox>
  );
}

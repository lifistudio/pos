"use client";

import {
  RiArchiveStackLine,
  RiBookOpenLine,
  RiCheckLine,
  RiCloseLine,
  RiCoupon3Line,
  RiDashboardLine,
  RiLogoutBoxRLine,
  RiMapPin2Line,
  RiPriceTag3Line,
  RiQuestionLine,
  RiReceiptLine,
  RiShoppingBag3Line,
  RiShieldKeyholeLine,
  RiBarChartBoxLine,
  RiSettings4Line,
  RiShoppingCart2Line,
  RiSideBarFill,
  RiUserHeartLine,
  type RemixiconComponentType,
} from "@remixicon/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { Avatar } from "@/components/base/avatar/avatar";
import {
  Dropdown,
  DropdownDivider,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import { ChevronUpDownSmall } from "@/components/foundations/icons/chevrons";
import { authClient } from "@/lib/auth-client";
import { cx } from "@/utils/cx";
import { BrandMark } from "./brand-mark";
import { countPendingOffline } from "@/app/(pos)/pos/offline/outbox";
import { ApprovalPinSheet } from "./approval-pin-sheet";
import { clearPosShell } from "./service-worker";
import { useToast } from "./toast";
import { useSession } from "./session-context";

/** `permission` berupa daftar = tampil bila user punya salah satunya; tanpa `permission` = semua pengguna. */
type NavEntry = {
  href: string;
  label: string;
  icon: RemixiconComponentType;
  permission?: string | string[];
  external?: boolean;
};

/** Hanya modul yang sudah tersedia; modul baru ditambahkan di sini bersama permission-nya. */
const PRIMARY_NAV: NavEntry[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: RiDashboardLine,
    permission: "dashboard:read",
  },
  {
    href: "/pos",
    label: "Kasir",
    icon: RiShoppingCart2Line,
    permission: "pos:access",
  },
  {
    href: "/sales",
    label: "Transaksi",
    icon: RiReceiptLine,
    permission: "sale:read",
  },
  {
    href: "/orders",
    label: "Order online",
    icon: RiShoppingBag3Line,
    permission: "online_order:read",
  },
  {
    href: "/products",
    label: "Produk",
    icon: RiPriceTag3Line,
    permission: "product:read",
  },
  {
    href: "/customers",
    label: "Customer",
    icon: RiUserHeartLine,
    permission: "customer:read",
  },
  {
    href: "/vouchers",
    label: "Voucher",
    icon: RiCoupon3Line,
    permission: "voucher:read",
  },
  {
    href: "/inventory",
    label: "Stok",
    icon: RiArchiveStackLine,
    permission: "inventory:read",
  },
  {
    href: "/reports",
    label: "Laporan",
    icon: RiBarChartBoxLine,
    permission: "report:read",
  },
];

const SECONDARY_NAV: NavEntry[] = [
  {
    href: "/settings",
    label: "Pengaturan",
    icon: RiSettings4Line,
    permission: [
      "branch:read",
      "user:read",
      "role:read",
      "api_key:read",
      "audit_log:read",
    ],
  },
  {
    href: "/panduan",
    label: "Panduan",
    icon: RiQuestionLine,
  },
  {
    href: "/api/v1/reference",
    label: "Dokumentasi API",
    icon: RiBookOpenLine,
    permission: "api_docs:read",
    external: true,
  },
];

/** Label yang menyusut saat rail diciutkan (pola Collapsible BoardUI). */
function Collapsible({
  collapsed,
  children,
  className,
}: {
  collapsed: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "flex min-w-0 items-center overflow-hidden transition-[max-width,opacity,filter] duration-300 ease-in-out",
        collapsed
          ? "max-w-0 opacity-0 blur-[3px]"
          : "max-w-full opacity-100 blur-0",
        className,
      )}
    >
      {children}
    </span>
  );
}

function NavItem({
  entry,
  selected,
  collapsed,
  onNavigate,
}: {
  entry: NavEntry;
  selected: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = entry.icon;
  const className = cx(
    "flex items-center overflow-hidden rounded-2lg p-2 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
    "transition-[width,background-color] duration-300 ease-in-out",
    collapsed ? "w-9" : "w-full",
    selected
      ? "bg-linear-to-b from-accent-500 to-accent-600 shadow-nav-selected"
      : "hover:bg-background-secondary-hover",
  );
  const content = (
    <span className="flex min-w-0 items-center gap-2">
      <Icon
        className={cx(
          "size-5 shrink-0",
          selected ? "text-white" : "text-foreground-icon-secondary",
        )}
        aria-hidden
      />
      <Collapsible collapsed={collapsed}>
        <span
          className={cx(
            "text-body-medium whitespace-nowrap",
            selected ? "text-white" : "text-text-secondary",
          )}
        >
          {entry.label}
        </span>
      </Collapsible>
    </span>
  );
  if (entry.external) {
    return (
      <a
        href={entry.href}
        target="_blank"
        rel="noopener"
        aria-label={entry.label}
        className={className}
        title={collapsed ? entry.label : undefined}
      >
        {content}
      </a>
    );
  }
  return (
    <Link
      href={entry.href}
      onClick={onNavigate}
      aria-label={entry.label}
      aria-current={selected ? "page" : undefined}
      title={collapsed ? entry.label : undefined}
      className={className}
    >
      {content}
    </Link>
  );
}

/** Pemilih cabang aktif. "Semua cabang" hanya muncul bila user punya akses ke lebih dari satu cabang. */
function BranchSwitcher({ collapsed }: { collapsed: boolean }) {
  const { me, branchId, setBranchId } = useSession();
  const [open, setOpen] = useState(false);
  const current = me.branches.find((b) => b.id === branchId);
  const label =
    current?.name ??
    (me.branches.length > 1
      ? "Semua cabang"
      : (me.branches[0]?.name ?? "Belum ada cabang"));

  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <DropdownTrigger
        aria-label={`Cabang aktif: ${label}`}
        className={cx(
          "flex items-center gap-2 rounded-2lg border border-border-button-default bg-background-primary-default p-2 text-start",
          "transition-[width,background-color] duration-300 ease-in-out hover:bg-background-primary-hover",
          collapsed ? "w-9 justify-center" : "w-full",
        )}
      >
        <RiMapPin2Line
          className="size-5 shrink-0 text-foreground-icon-secondary"
          aria-hidden
        />
        <Collapsible
          collapsed={collapsed}
          className="flex-1 justify-between gap-1"
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-caption-1-medium text-text-tertiary">
              Cabang
            </span>
            <span className="truncate text-body-medium text-text-primary">
              {label}
            </span>
          </span>
          <ChevronUpDownSmall className="size-4 shrink-0 text-foreground-icon-tertiary" />
        </Collapsible>
      </DropdownTrigger>
      <DropdownPopover
        aria-label="Pilih cabang"
        placement="bottom start"
        className="min-w-60"
      >
        {me.branches.length > 1 && (
          <>
            <DropdownItem
              selected={!branchId}
              onSelect={() => {
                setBranchId(null);
                setOpen(false);
              }}
            >
              <span className="flex w-full items-center justify-between gap-3">
                Semua cabang
                {!branchId && (
                  <RiCheckLine className="size-4 text-accent-500" aria-hidden />
                )}
              </span>
            </DropdownItem>
            <DropdownDivider />
          </>
        )}
        {me.branches.map((b) => (
          <DropdownItem
            key={b.id}
            selected={b.id === branchId}
            onSelect={() => {
              setBranchId(b.id);
              setOpen(false);
            }}
          >
            <span className="flex w-full items-center justify-between gap-3">
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{b.name}</span>
                <span className="text-caption-1-regular text-text-tertiary">
                  {b.code} ·{" "}
                  {b.type === "WAREHOUSE"
                    ? "Gudang"
                    : b.type === "ONLINE"
                      ? "Online"
                      : "Toko"}
                </span>
              </span>
              {b.id === branchId && (
                <RiCheckLine
                  className="size-4 shrink-0 text-accent-500"
                  aria-hidden
                />
              )}
            </span>
          </DropdownItem>
        ))}
      </DropdownPopover>
    </Dropdown>
  );
}

function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const { me } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const initials = me.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function signOut() {
    // Transaksi offline yang belum tersinkron hanya bisa dikirim oleh kasir yang sama → jangan keluar dulu.
    const pending = await countPendingOffline();
    if (pending > 0) {
      toast.show({ status: "error", title: `${pending} transaksi offline belum tersinkron`, description: "Buka Kasir saat online agar terkirim, lalu keluar." });
      return;
    }
    await clearPosShell();
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <Dropdown isOpen={open} onOpenChange={setOpen}>
        <DropdownTrigger
          aria-label={`Akun: ${me.name}`}
          className={cx(
            "flex items-center gap-2 rounded-2lg p-1.5 hover:bg-background-secondary-hover",
            collapsed ? "w-9 justify-center p-0.5" : "w-full",
          )}
        >
          <Avatar size="sm" color="neutral" initials={initials} />
          <Collapsible collapsed={collapsed} className="flex-1">
            <span className="flex min-w-0 flex-col text-start">
              <span className="truncate text-body-medium text-text-primary">
                {me.name}
              </span>
              <span className="truncate text-caption-1-regular text-text-tertiary">
                {me.roles.join(", ") || "Tanpa role"}
              </span>
            </span>
          </Collapsible>
        </DropdownTrigger>
        <DropdownPopover
          aria-label="Menu akun"
          placement="top start"
          className="min-w-60"
        >
          <div className="flex flex-col px-2 py-1.5">
            <span className="text-body-medium text-text-primary">
              {me.name}
            </span>
            <span className="truncate text-body-2-regular text-text-tertiary">
              {me.email}
            </span>
          </div>
          <DropdownDivider />
          {me.authType === "USER" && (
            <DropdownItem
              onSelect={() => {
                setOpen(false);
                setPinOpen(true);
              }}
            >
              <span className="flex items-center gap-2">
                <RiShieldKeyholeLine
                  className="size-4 text-foreground-icon-secondary"
                  aria-hidden
                />
                {me.hasApprovalPin
                  ? "Ganti PIN persetujuan"
                  : "Atur PIN persetujuan"}
              </span>
            </DropdownItem>
          )}
          <DropdownItem onSelect={signOut}>
            <span className="flex items-center gap-2">
              <RiLogoutBoxRLine
                className="size-4 text-foreground-icon-secondary"
                aria-hidden
              />
              Keluar
            </span>
          </DropdownItem>
        </DropdownPopover>
      </Dropdown>
      <ApprovalPinSheet isOpen={pinOpen} onClose={() => setPinOpen(false)} />
    </>
  );
}

export function AppSidebar({
  mobile = false,
  onClose,
}: {
  mobile?: boolean;
  onClose?: () => void;
}) {
  const { can } = useSession();
  const allowed = (n: NavEntry) =>
    !n.permission || (Array.isArray(n.permission) ? n.permission.some(can) : can(n.permission));
  const pathname = usePathname();
  const [collapsedState, setCollapsed] = useState(false);
  const collapsed = mobile ? false : collapsedState;
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside
      className={cx(
        "flex h-full shrink-0 flex-col justify-between overflow-hidden rounded-3xl border border-border-button-white bg-background-secondary-default shadow-sidebar",
        "transition-[width] duration-300 ease-in-out",
        collapsed
          ? "w-[60px] px-[11px] py-3"
          : mobile
            ? "w-full p-3"
            : "w-[260px] p-3",
      )}
    >
      <div className="relative -m-2 flex min-h-0 w-[calc(100%+16px)] flex-col gap-4 overflow-y-auto p-2 [scrollbar-width:none]">
        <div
          className={cx(
            "flex w-full",
            collapsed
              ? "flex-col-reverse items-start gap-3"
              : "items-center justify-between",
          )}
        >
          <Collapsible collapsed={collapsed}>
            <BrandMark />
          </Collapsible>
          {mobile ? (
            <button
              type="button"
              aria-label="Tutup menu"
              onClick={onClose}
              className="cursor-pointer rounded-md p-1 text-foreground-icon-secondary"
            >
              <RiCloseLine className="size-5" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              aria-label={collapsed ? "Lebarkan sidebar" : "Ciutkan sidebar"}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((v) => !v)}
              className={cx(
                "cursor-pointer rounded-md text-foreground-icon-secondary",
                collapsed && "flex w-9 justify-center",
              )}
            >
              <RiSideBarFill
                className={cx(
                  "size-5 transition-transform duration-300",
                  collapsed ? "" : "-scale-x-100",
                )}
                aria-hidden
              />
            </button>
          )}
        </div>

        <BranchSwitcher collapsed={collapsed} />

        <nav
          aria-label="Navigasi utama"
          className={cx("flex w-full flex-col gap-1", !collapsed && "px-0.5")}
        >
          {PRIMARY_NAV.filter(allowed).map((entry) => (
            <NavItem
              key={entry.href}
              entry={entry}
              selected={isActive(entry.href)}
              collapsed={collapsed}
              onNavigate={onClose}
            />
          ))}
        </nav>
      </div>

      <div className="flex w-full shrink-0 flex-col gap-3 pt-3">
        {collapsed ? (
          <ThemeToggle collapsed />
        ) : (
          <ThemeToggle appearance="sidebar-segmented" />
        )}
        <nav aria-label="Navigasi lain" className="flex w-full flex-col gap-1">
          {SECONDARY_NAV.filter(allowed).map((entry) => (
            <NavItem
              key={entry.href}
              entry={entry}
              selected={!entry.external && isActive(entry.href)}
              collapsed={collapsed}
              onNavigate={onClose}
            />
          ))}
        </nav>
        <AccountMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}

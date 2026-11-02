"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Tautan lupa password hanya tampil bila server punya SMTP; tanpa itu arahkan ke admin. */
export function LoginHelp() {
  const [canReset, setCanReset] = useState(false);
  useEffect(() => {
    fetch("/api/public/config")
      .then((r) => r.json())
      .then((c: { passwordReset?: boolean }) => setCanReset(!!c.passwordReset))
      .catch(() => null);
  }, []);
  if (canReset) {
    return (
      <Link href="/forgot-password" className="mt-6 block text-body-2-medium text-text-secondary">
        Lupa password?
      </Link>
    );
  }
  return <p className="mt-6 text-body-2-regular text-text-tertiary">Lupa password? Minta admin atau owner mengatur ulang dari menu Pengguna.</p>;
}

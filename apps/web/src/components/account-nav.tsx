"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchMe, logoutAccount, type Me } from "../lib/api/account";

export function AccountNav() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await fetchMe(controller.signal);
        if (!controller.signal.aborted) setMe(result.ok ? result.value : null);
      } catch {
        if (!controller.signal.aborted) setMe(null);
      }
    })();
    return () => controller.abort();
  }, []);

  if (me === undefined) return null;
  if (me === null) {
    return (
      <li>
        <Link href="/login">Sign in</Link>
      </li>
    );
  }

  async function logout(): Promise<void> {
    await logoutAccount();
    window.location.assign("/");
  }

  return (
    <>
      <li>
        <Link href="/account">Account</Link>
      </li>
      <li>
        <button className="nav-link" type="button" onClick={() => void logout()}>
          Log out
        </button>
      </li>
    </>
  );
}

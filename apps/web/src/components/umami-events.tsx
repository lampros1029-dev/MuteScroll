"use client";

import { useEffect } from "react";

import { trackUmami } from "../lib/umami-track";

/** Fires the signup event after Google creates an account. Email sign-up fires from the form. */
export function UmamiEvents() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("ms_signed_up") !== "1") return;
    trackUmami("signup");
    url.searchParams.delete("ms_signed_up");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", next);
  }, []);

  return null;
}

"use client";

import { useEffect, useRef, useState } from "react";

import { copyText } from "../lib/clipboard";

interface CopyButtonProps {
  readonly label: string;
  readonly value: string;
  readonly className?: string;
}

type CopyState = "idle" | "copied" | "failed";

const RESET_MS = 2200;

export function CopyButton({ label, value, className = "btn btn-quiet" }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  async function onClick() {
    const ok = await copyText(value);
    setState(ok ? "copied" : "failed");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), RESET_MS);
  }

  const visible = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label;
  const announcement =
    state === "copied"
      ? `${label} copied to the clipboard.`
      : state === "failed"
        ? "The browser blocked copying. Select the text and copy it manually."
        : "";

  return (
    <>
      <button type="button" className={className} onClick={onClick}>
        {visible}
      </button>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </>
  );
}

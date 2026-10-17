"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

import { fetchMe } from "../../lib/api/account";

const PADDLE_SRC = "https://cdn.paddle.com/paddle/v2/paddle.js";
const SUCCESS_URL = "https://mutescroll.xyz/billing/success";
const FRAME_TARGET = "paddle-checkout-frame";
const FRAME_STYLE = "width: 100%; min-width: 312px; background-color: #14130f; border: none;";

interface PaddleNamespace {
  Environment: {
    set: (environment: "sandbox" | "production") => void;
  };
  Initialize: (options: {
    readonly token: string;
    readonly checkout?: {
      readonly settings: {
        readonly displayMode: "inline";
        readonly theme: "dark";
        readonly variant: "one-page";
        readonly frameTarget: string;
        readonly frameInitialHeight: string;
        readonly frameStyle: string;
      };
    };
  }) => void;
  Checkout: {
    open: (options: {
      readonly transactionId: string;
      readonly customer?: { readonly email: string };
      readonly settings: {
        readonly displayMode: "inline";
        readonly theme: "dark";
        readonly variant: "one-page";
        readonly successUrl: string;
        readonly allowLogout: boolean;
        readonly frameTarget: string;
        readonly frameInitialHeight: string;
        readonly frameStyle: string;
      };
    }) => void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleNamespace;
  }
}

let paddleStarted = false;
let openedTransactionId = "";

function checkoutEmail(value: string): string | undefined {
  const email = value.trim();
  if (email.length === 0 || email.length > 254 || !email.includes("@") || /\s/.test(email)) return undefined;
  return email;
}

function boot(transactionId: string, email: string): void {
  if (typeof window === "undefined") return;
  const paddle = window.Paddle;
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? "";
  if (!paddle || token.length === 0) return;

  if (!paddleStarted) {
    if (token.startsWith("test_")) paddle.Environment.set("sandbox");
    paddle.Initialize({
      token,
      checkout: {
        settings: {
          displayMode: "inline",
          theme: "dark",
          variant: "one-page",
          frameTarget: FRAME_TARGET,
          frameInitialHeight: "450",
          frameStyle: FRAME_STYLE,
        },
      },
    });
    paddleStarted = true;
  }

  const id = transactionId.trim();
  if (id.length === 0 || openedTransactionId === id) return;
  const customerEmail = checkoutEmail(email);
  openedTransactionId = id;
  paddle.Checkout.open({
    transactionId: id,
    ...(customerEmail === undefined ? {} : { customer: { email: customerEmail } }),
    settings: {
      displayMode: "inline",
      theme: "dark",
      variant: "one-page",
      successUrl: SUCCESS_URL,
      allowLogout: customerEmail === undefined,
      frameTarget: FRAME_TARGET,
      frameInitialHeight: "450",
      frameStyle: FRAME_STYLE,
    },
  });
}

export function PaddleCheckout({ transactionId }: { readonly transactionId: string }) {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const account = await fetchMe(controller.signal);
        if (controller.signal.aborted) return;
        setEmail(account.ok && account.value !== null ? account.value.email : "");
      } catch {
        if (!controller.signal.aborted) setEmail("");
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (email === null) return;
    boot(transactionId, email);
  }, [transactionId, email]);

  return (
    <>
      <div className={FRAME_TARGET} />
      <Script
        src={PADDLE_SRC}
        strategy="afterInteractive"
        onLoad={() => {
          if (email !== null) boot(transactionId, email);
        }}
      />
    </>
  );
}

"use client";

import Script from "next/script";
import { useEffect } from "react";

const PADDLE_SRC = "https://cdn.paddle.com/paddle/v2/paddle.js";
const SUCCESS_URL = "https://mutescroll.xyz/billing/success";

interface PaddleNamespace {
  Environment: {
    set: (environment: "sandbox" | "production") => void;
  };
  Initialize: (options: { readonly token: string; readonly pwCustomer?: { readonly id: string } }) => void;
  Checkout: {
    open: (options: {
      readonly transactionId: string;
      readonly settings: { readonly successUrl: string };
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

function boot(transactionId: string, paddleCustomerId: string): void {
  if (typeof window === "undefined") return;
  const paddle = window.Paddle;
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? "";
  if (!paddle || token.length === 0) return;

  if (!paddleStarted) {
    if (token.startsWith("test_")) paddle.Environment.set("sandbox");
    const customerId = paddleCustomerId.trim();
    paddle.Initialize({
      token,
      ...(customerId.startsWith("ctm_") ? { pwCustomer: { id: customerId } } : {}),
    });
    paddleStarted = true;
  }

  const id = transactionId.trim();
  if (id.length === 0 || openedTransactionId === id) return;
  openedTransactionId = id;
  paddle.Checkout.open({
    transactionId: id,
    settings: { successUrl: SUCCESS_URL },
  });
}

export function PaddleCheckout({
  transactionId,
  paddleCustomerId = "",
}: {
  readonly transactionId: string;
  /** Paddle customer id (`ctm_...`) only. Omit when the account API has not returned one. */
  readonly paddleCustomerId?: string;
}) {
  useEffect(() => {
    boot(transactionId, paddleCustomerId);
  }, [transactionId, paddleCustomerId]);

  return <Script src={PADDLE_SRC} strategy="afterInteractive" onLoad={() => boot(transactionId, paddleCustomerId)} />;
}

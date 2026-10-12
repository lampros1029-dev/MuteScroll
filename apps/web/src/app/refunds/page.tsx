import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument } from "../../components/legal-document";
import { PADDLE_BUYER_TERMS_URL, PADDLE_REFUND_POLICY_URL, REFUND_DAYS } from "../../lib/legal";
import { SITE_NAME } from "../../lib/site";

export const metadata: Metadata = {
  title: "Refunds",
  description: "How to cancel a MuteScroll plan and how the 30-day refund works.",
  alternates: { canonical: "/refunds" },
};

export default function RefundsPage() {
  return (
    <LegalDocument
      title="Refunds and cancellation"
      lede={`This is the refund rule for a paid ${SITE_NAME} plan. It matches the guarantee on the pricing page.`}
    >
      <section aria-labelledby="cancel">
        <h2 id="cancel">Cancel a plan</h2>
        <p>
          You can cancel at any time from the Paddle portal. The link is in the receipt email, under manage subscription.
          Cancellation stops the next charge. The plan keeps working until the end of the period you have already paid
          for.
        </p>
      </section>

      <section aria-labelledby="refund">
        <h2 id="refund">30-day refund</h2>
        <p>
          If a paid plan is not right for you, you can ask for a full refund of the last payment within {REFUND_DAYS}{" "}
          days of that payment. Ask from the Paddle receipt, or email us and we will approve the refund in Paddle. A
          failed transcription does not spend a credit, so it is not a refund case.
        </p>
      </section>

      <section aria-labelledby="statutory">
        <h2 id="statutory">Statutory withdrawal</h2>
        <p>
          Consumers in the EU, the EEA, and the UK also have a 14-day right to withdraw, which Paddle provides under its{" "}
          <a href={PADDLE_BUYER_TERMS_URL}>buyer terms</a> and <a href={PADDLE_REFUND_POLICY_URL}>refund policy</a>. That
          right can end earlier if you agree at checkout to start using the service immediately and then you do start
          using it. The {REFUND_DAYS}-day promise above is {SITE_NAME}&apos;s own rule, and we honour it in Paddle even
          when the statutory window has closed.
        </p>
      </section>

      <section aria-labelledby="tax">
        <h2 id="tax">Business tax refunds</h2>
        <p>
          If you were charged VAT or sales tax and you are registered for that tax in the country of purchase, Paddle
          asks you to request a tax refund within 60 days and to provide the tax number. That request goes to Paddle,
          because Paddle is the seller on the receipt. The catalog price on our <Link href="/pricing">pricing page</Link>{" "}
          does not include that tax.
        </p>
      </section>
    </LegalDocument>
  );
}

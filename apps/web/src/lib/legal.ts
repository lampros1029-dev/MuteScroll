import { CONTACT_EMAIL, SITE_NAME } from "./site";

/** Published operator identity and the dates on the legal pages. */

export const LEGAL_UPDATED = "14 October 2026";

/** Published operator. An individual in Athens. */
export const OPERATOR_NAME = "Labros Aggelopoulos";

/** Correspondence address. */
export const OPERATOR_ADDRESS = "Arionos 17, Peristeri, Greece";

/** Host and application logs are capped at this many days. */
export const LOG_RETENTION_DAYS = 30;

export const PADDLE_BUYER_TERMS_URL = "https://www.paddle.com/legal/buyer-terms";

export const PADDLE_REFUND_POLICY_URL = "https://www.paddle.com/legal/refund-policy";

export const PADDLE_PRIVACY_URL = "https://www.paddle.com/legal/privacy";

export const REFUND_DAYS = 30;

export const SESSION_DAYS = 30;

export const MIN_PAID_AGE = 18;

export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;

/**
 * Catalog prices are tax-exclusive. Paddle adds VAT or sales tax for the
 * buyer's country at checkout. The sticker amounts in pricing.ts stay put.
 */
export const TAX_NOTE = `Prices are in US dollars and do not include VAT or sales tax. ${SITE_NAME} does not add that tax. Paddle, the seller at checkout, adds the tax for your country and shows the total before you pay.`;

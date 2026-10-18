import type { PaddleSubject } from "./provider.js";

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const LINK_KEY = /^[A-Za-z0-9_-]{1,80}$/;
const CHECKOUT_NONCE = /^[A-Za-z0-9_-]{16,64}$/;

/** Paddle ids and server-issued checkout nonces share one table. */
export function isBillingLinkKey(value: string): boolean {
  return LINK_KEY.test(value);
}

export function isAccountId(value: string): boolean {
  return ACCOUNT_ID.test(value);
}

/** A `sub_`, `ctm_`, or `txn_` id Paddle minted. Anything else is ignored. */
export function readPaddleId(value: unknown, prefix: "sub" | "ctm" | "txn"): string | null {
  if (typeof value !== "string") return null;
  if (!new RegExp(`^${prefix}_[A-Za-z0-9]{1,60}$`).test(value)) return null;
  if (!isBillingLinkKey(value)) return null;
  return value;
}

/** Nonce this server put on the checkout. Short or foreign tokens are ignored. */
export function readCheckoutNonce(value: unknown): string | null {
  if (typeof value !== "string" || !CHECKOUT_NONCE.test(value)) return null;
  return value;
}

/**
 * Maps a Paddle id, or a checkout nonce this server issued, to the user who started checkout.
 * `bind` refuses to move an id onto a different user.
 */
export interface BillingLinkStore {
  bind(paddleId: string, userId: string): Promise<boolean>;
  userFor(paddleId: string): Promise<string | undefined>;
  /** Every Paddle id and checkout nonce stored for this user. */
  idsForUser(userId: string): Promise<readonly string[]>;
  /** Drops one id. Used when Paddle says that customer no longer exists. */
  forget(paddleId: string): Promise<void>;
  removeForUser(userId: string): Promise<void>;
}

/** Process-local links used when DATABASE_URL is unset. Lost on restart. */
export class MemoryBillingLinkStore implements BillingLinkStore {
  private readonly links = new Map<string, string>();

  async bind(paddleId: string, userId: string): Promise<boolean> {
    if (!isBillingLinkKey(paddleId) || !isAccountId(userId)) return false;
    const existing = this.links.get(paddleId);
    if (existing !== undefined) return existing === userId;
    this.links.set(paddleId, userId);
    return true;
  }

  async userFor(paddleId: string): Promise<string | undefined> {
    if (!isBillingLinkKey(paddleId)) return undefined;
    return this.links.get(paddleId);
  }

  async idsForUser(userId: string): Promise<readonly string[]> {
    if (!isAccountId(userId)) return [];
    return [...this.links.entries()].filter(([, owner]) => owner === userId).map(([id]) => id);
  }

  async forget(paddleId: string): Promise<void> {
    if (!isBillingLinkKey(paddleId)) return;
    this.links.delete(paddleId);
  }

  async removeForUser(userId: string): Promise<void> {
    for (const [id, owner] of this.links) {
      if (owner === userId) this.links.delete(id);
    }
  }
}

/**
 * User a notification may change, or undefined when the event must be ignored.
 *
 * setPlan is allowed only when the subscription id — or the customer id, if the event has no
 * subscription id — is already stored for that same user. Checkout writes the transaction id and
 * a nonce. A later notification may copy that owner onto its subscription or customer id when the
 * transaction id or nonce matches and custom_data.user_id is that same owner. A bare user id does not.
 */
export async function authorizeBillingSubject(
  links: BillingLinkStore,
  subject: PaddleSubject,
  claimedUserId: string | null,
): Promise<string | undefined> {
  if (subject.subscriptionId !== null) {
    const owner = await links.userFor(subject.subscriptionId);
    if (owner !== undefined) {
      if (!sameUser(claimedUserId, owner)) return undefined;
      if (subject.customerId !== null) await links.bind(subject.customerId, owner);
      return owner;
    }
  } else if (subject.customerId !== null) {
    const owner = await links.userFor(subject.customerId);
    if (owner !== undefined) {
      if (!sameUser(claimedUserId, owner)) return undefined;
      return owner;
    }
  }

  const owner = await checkoutOwner(links, subject);
  if (owner === undefined || !sameUser(claimedUserId, owner)) return undefined;
  if (claimedUserId === null && !(await transactionMatches(links, subject, owner))) return undefined;

  if (subject.subscriptionId !== null) {
    if (!(await links.bind(subject.subscriptionId, owner))) return undefined;
    if (subject.customerId !== null) await links.bind(subject.customerId, owner);
    return owner;
  }
  if (subject.customerId !== null) {
    if (!(await links.bind(subject.customerId, owner))) return undefined;
    return owner;
  }
  if (subject.transactionId !== null && (await links.userFor(subject.transactionId)) === owner) return owner;
  return undefined;
}

async function checkoutOwner(links: BillingLinkStore, subject: PaddleSubject): Promise<string | undefined> {
  const fromTxn = subject.transactionId === null ? undefined : await links.userFor(subject.transactionId);
  const fromNonce = subject.checkoutNonce === null ? undefined : await links.userFor(subject.checkoutNonce);
  if (fromTxn !== undefined && fromNonce !== undefined && fromTxn !== fromNonce) return undefined;
  return fromTxn ?? fromNonce;
}

/** A missing custom_data user id may attach ids only from a transaction this server created. */
async function transactionMatches(links: BillingLinkStore, subject: PaddleSubject, owner: string): Promise<boolean> {
  if (subject.transactionId === null) return false;
  return (await links.userFor(subject.transactionId)) === owner;
}

function sameUser(claimedUserId: string | null, owner: string): boolean {
  return claimedUserId === null || claimedUserId === owner;
}

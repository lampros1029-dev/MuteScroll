import { randomBytes, randomUUID } from "node:crypto";

import type { ExternalIdentityStore } from "./external-identities.js";
import { normalizeEmail } from "./email.js";
import { hashPassword } from "./passwords.js";
import { EmailTakenError, type UserRecord, type UserStore } from "./types.js";

export type GoogleLinkProblem = "unverified_email" | "unverified_existing";

export class GoogleLinkError extends Error {
  constructor(readonly problem: GoogleLinkProblem) {
    super(problem);
    this.name = "GoogleLinkError";
  }
}

export interface GoogleAccountInput {
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/**
 * Finds or creates the MuteScroll account for a verified Google email.
 * An unverified existing account is left alone, so a password someone else set cannot be taken over.
 */
export async function accountForGoogle(
  users: UserStore,
  identities: ExternalIdentityStore,
  input: GoogleAccountInput,
  now: number,
): Promise<UserRecord> {
  if (!input.emailVerified) throw new GoogleLinkError("unverified_email");
  const email = normalizeEmail(input.email);
  if (email === null) throw new GoogleLinkError("unverified_email");

  const linked = await identities.find("google", input.subject);
  if (linked !== undefined) {
    const user = await users.findById(linked.userId);
    if (user !== undefined) return user;
  }

  const existing = await users.findByEmail(email);
  if (existing !== undefined) {
    if (existing.emailVerifiedAt === null) throw new GoogleLinkError("unverified_existing");
    await rememberLink(identities, input.subject, existing.id, email, now);
    return existing;
  }

  const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
  try {
    const created = await users.create({
      id: `usr_${randomUUID()}`,
      email,
      passwordHash,
      plan: "free",
      createdAt: now,
      emailVerifiedAt: now,
    });
    await rememberLink(identities, input.subject, created.id, email, now);
    return created;
  } catch (error) {
    if (!(error instanceof EmailTakenError)) throw error;
    const raced = await users.findByEmail(email);
    if (raced === undefined || raced.emailVerifiedAt === null) throw new GoogleLinkError("unverified_existing");
    await rememberLink(identities, input.subject, raced.id, email, now);
    return raced;
  }
}

async function rememberLink(identities: ExternalIdentityStore, subject: string, userId: string, email: string, now: number): Promise<void> {
  const linked = await identities.link({ provider: "google", subject, userId, email, createdAt: now });
  if (linked) return;
  const current = await identities.find("google", subject);
  if (current !== undefined && current.userId !== userId) throw new GoogleLinkError("unverified_existing");
}

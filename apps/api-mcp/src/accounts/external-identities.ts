/** A verified sign-in from another provider, tied to one MuteScroll account. */
export interface ExternalIdentity {
  readonly provider: "google";
  readonly subject: string;
  readonly userId: string;
  readonly email: string;
  readonly createdAt: number;
}

export interface ExternalIdentityStore {
  find(provider: ExternalIdentity["provider"], subject: string): Promise<ExternalIdentity | undefined>;
  /** False when this provider subject is already linked. */
  link(identity: ExternalIdentity): Promise<boolean>;
  removeForUser(userId: string): Promise<void>;
}

function keyFor(provider: string, subject: string): string {
  return `${provider}\n${subject}`;
}

/** Single-process identity links. Used when DATABASE_URL is unset. */
export class MemoryExternalIdentityStore implements ExternalIdentityStore {
  private readonly rows = new Map<string, ExternalIdentity>();

  async find(provider: ExternalIdentity["provider"], subject: string): Promise<ExternalIdentity | undefined> {
    const row = this.rows.get(keyFor(provider, subject));
    return row === undefined ? undefined : { ...row };
  }

  async link(identity: ExternalIdentity): Promise<boolean> {
    const key = keyFor(identity.provider, identity.subject);
    if (this.rows.has(key)) return false;
    this.rows.set(key, { ...identity });
    return true;
  }

  async removeForUser(userId: string): Promise<void> {
    for (const [key, identity] of this.rows) {
      if (identity.userId === userId) this.rows.delete(key);
    }
  }
}

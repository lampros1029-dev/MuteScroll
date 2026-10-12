import {
  EmailTakenError,
  type ApiKeyRecord,
  type ApiKeyStore,
  type NewUser,
  type SessionRecord,
  type SessionStore,
  type UserRecord,
  type UserStore,
} from "./types.js";

/** Single-process account stores. Used when DATABASE_URL is unset; state is lost on restart. */
export class MemoryUserStore implements UserStore {
  private readonly byId = new Map<string, UserRecord>();
  private readonly idByEmail = new Map<string, string>();

  async create(input: NewUser): Promise<UserRecord> {
    if (this.idByEmail.has(input.email)) throw new EmailTakenError();
    const user: UserRecord = { ...input };
    this.byId.set(user.id, user);
    this.idByEmail.set(user.email, user.id);
    return { ...user };
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    const id = this.idByEmail.get(email);
    return id === undefined ? undefined : this.findById(id);
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    const user = this.byId.get(id);
    return user === undefined ? undefined : { ...user };
  }
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  async create(record: SessionRecord): Promise<void> {
    this.sessions.set(record.tokenHash, { ...record });
  }

  async find(tokenHash: string): Promise<SessionRecord | undefined> {
    const record = this.sessions.get(tokenHash);
    return record === undefined ? undefined : { ...record };
  }

  async extend(tokenHash: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    const record = this.sessions.get(tokenHash);
    if (record !== undefined) this.sessions.set(tokenHash, { ...record, lastSeenAt, expiresAt });
  }

  async remove(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async removeExpired(now: number): Promise<number> {
    let removed = 0;
    for (const [tokenHash, record] of [...this.sessions.entries()]) {
      if (record.expiresAt <= now) {
        this.sessions.delete(tokenHash);
        removed += 1;
      }
    }
    return removed;
  }
}

export class MemoryApiKeyStore implements ApiKeyStore {
  private readonly keys = new Map<string, ApiKeyRecord>();

  async create(record: ApiKeyRecord): Promise<void> {
    this.keys.set(record.id, { ...record });
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | undefined> {
    for (const record of this.keys.values()) {
      if (record.keyHash === keyHash) return { ...record };
    }
    return undefined;
  }

  async listForUser(userId: string): Promise<ApiKeyRecord[]> {
    return [...this.keys.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((record) => ({ ...record }));
  }

  async markUsed(id: string, usedAt: number): Promise<void> {
    const record = this.keys.get(id);
    if (record !== undefined) this.keys.set(id, { ...record, lastUsedAt: usedAt });
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const record = this.keys.get(id);
    if (record === undefined || record.userId !== userId) return false;
    this.keys.delete(id);
    return true;
  }
}

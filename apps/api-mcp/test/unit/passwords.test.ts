import { describe, expect, it } from "vitest";

import { hashPassword, passwordPolicyError, spendPasswordCheck, verifyPassword } from "../../src/accounts/passwords.js";

describe("password policy (PRD 17)", () => {
  it("accepts 10 to 128 characters", () => {
    expect(passwordPolicyError("x".repeat(10))).toBeNull();
    expect(passwordPolicyError("x".repeat(128))).toBeNull();
  });

  it("rejects shorter and longer passwords with the policy message", () => {
    expect(passwordPolicyError("x".repeat(9))).toMatch(/10 to 128 characters/);
    expect(passwordPolicyError("x".repeat(129))).toMatch(/10 to 128 characters/);
    expect(passwordPolicyError("")).toMatch(/10 to 128/);
  });

  it("counts characters rather than UTF-16 code units", () => {
    expect(passwordPolicyError("αβγδεζηθικ")).toBeNull();
    expect(passwordPolicyError("😀".repeat(9))).toMatch(/10 to 128/);
    expect(passwordPolicyError("😀".repeat(10))).toBeNull();
  });
});

describe("scrypt password hashing", () => {
  it("stores a self-describing hash with a fresh salt and never the password", async () => {
    const first = await hashPassword("correct horse battery");
    const second = await hashPassword("correct horse battery");
    expect(first.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(first.split("$")).toHaveLength(6);
    expect(first).not.toBe(second);
    expect(first).not.toContain("correct");
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("answers false, without throwing, for malformed or out-of-bounds stored values", async () => {
    const salt = "A".repeat(22);
    const key = "B".repeat(86);
    const malformed = [
      "",
      "not-a-hash",
      `bcrypt$12$${salt}$${key}`,
      `scrypt$32768$8$1$${salt}`,
      `scrypt$1$8$1$${salt}$${key}`,
      `scrypt$262144$8$1$${salt}$${key}`,
      `scrypt$32000$8$1$${salt}$${key}`,
      `scrypt$32768$64$1$${salt}$${key}`,
      `scrypt$32768$8$9$${salt}$${key}`,
      `scrypt$32768$8$1$short$${key}`,
      `scrypt$32768$8$1$${salt}$short`,
    ];
    for (const stored of malformed) {
      expect(await verifyPassword("whatever password", stored)).toBe(false);
    }
  });

  it("runs a comparable check for unknown accounts without revealing anything", async () => {
    await expect(spendPasswordCheck("whatever password")).resolves.toBeUndefined();
    await expect(spendPasswordCheck("another password")).resolves.toBeUndefined();
  });
});

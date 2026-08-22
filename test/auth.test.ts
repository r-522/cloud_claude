// File: test/auth.test.ts
import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  timingSafeEqual,
  verifySessionToken,
} from "../src/auth";

const SECRET = "test-secret-key-at-least-16-chars";

describe("timingSafeEqual", () => {
  it("accepts equal values", () => {
    expect(timingSafeEqual("1359", "1359")).toBe(true);
  });

  it("rejects different values", () => {
    expect(timingSafeEqual("1359", "1358")).toBe(false);
    expect(timingSafeEqual("1359", "13590")).toBe(false);
  });
});

describe("session tokens", () => {
  it("creates and verifies a valid token", async () => {
    const now = 1_700_000_000_000;
    const token = await createSessionToken(SECRET, now);
    await expect(verifySessionToken(token, SECRET, now + 1_000)).resolves.toBe(true);
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken(SECRET);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    await expect(verifySessionToken(tampered, SECRET)).resolves.toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(SECRET);
    await expect(verifySessionToken(token, "other-secret-key-value")).resolves.toBe(false);
  });

  it("rejects an expired token", async () => {
    const now = 1_700_000_000_000;
    const token = await createSessionToken(SECRET, now);
    await expect(
      verifySessionToken(token, SECRET, now + 8 * 24 * 60 * 60 * 1000),
    ).resolves.toBe(false);
  });

  it("rejects missing token or secret", async () => {
    await expect(verifySessionToken(undefined, SECRET)).resolves.toBe(false);
    await expect(verifySessionToken("a.b", "")).resolves.toBe(false);
  });
});

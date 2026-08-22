// File: src/auth.ts
/**
 * 簡易アクセス制限用のセッション。
 * HMAC-SHA256で署名した短命トークンをHttpOnly Cookieに格納する。
 * Claude APIキー等の秘密情報はクライアントへ一切渡さない。
 */

const encoder = new TextEncoder();

export const SESSION_COOKIE = "session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7日

export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const length = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length === bBytes.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(signature);
}

export async function createSessionToken(
  secret: string,
  now: number = Date.now(),
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  const payload = JSON.stringify({ exp: Math.floor(now / 1000) + ttlSeconds });
  const encodedPayload = toBase64Url(encoder.encode(payload));
  const signature = toBase64Url(await hmac(secret, encodedPayload));
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
  secret: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return false;

  const expectedSignature = toBase64Url(await hmac(secret, encodedPayload));
  if (!timingSafeEqual(signature, expectedSignature)) return false;

  try {
    const payloadJson = new TextDecoder().decode(fromBase64Url(encodedPayload));
    const payload = JSON.parse(payloadJson) as { exp?: unknown };
    return typeof payload.exp === "number" && payload.exp * 1000 > now;
  } catch {
    return false;
  }
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}

export function buildSessionCookie(token: string, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const attrs = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

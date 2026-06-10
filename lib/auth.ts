import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { cookies } from "next/headers";

import { AUTH_COOKIE_NAME } from "@/lib/authConstants";
import { AppError } from "@/lib/errors";

const scrypt = promisify(scryptCallback);

type SessionPayload = {
  email: string;
  exp: number;
};

export async function authenticateAdmin(email: string, password: string) {
  const adminEmail = getAdminEmail();
  const passwordHash = getAdminPasswordHash();
  if (!passwordHash) {
    throw new AppError("INTERNAL_ERROR", "\u0041\u0044\u004d\u0049\u004e\u005f\u0050\u0041\u0053\u0053\u0057\u004f\u0052\u0044\u005f\u0048\u0041\u0053\u0048 \u672a\u914d\u7f6e\uff0c\u65e0\u6cd5\u767b\u5f55\u3002");
  }

  const emailMatches = email.trim().toLowerCase() === adminEmail.toLowerCase();
  const passwordMatches = await verifyPassword(password, passwordHash);
  if (!emailMatches || !passwordMatches) {
    throw new AppError("UNAUTHORIZED", "\u8d26\u53f7\u6216\u5bc6\u7801\u9519\u8bef\u3002");
  }

  return { email: adminEmail };
}

export async function hashPassword(password: string, salt = randomBytes(18).toString("base64url")) {
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encodedHash: string) {
  const [algorithm, salt, expectedHash] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHash) return false;

  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHash, "base64url");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export async function createSessionCookie(email: string) {
  const store = await cookies();
  const cookie = createSessionCookieData(email);
  store.set(cookie.name, cookie.value, cookie.options);
}

export function createSessionCookieData(email: string) {
  const maxAge = numberEnv("AUTH_SESSION_DAYS", 7) * 24 * 60 * 60;
  const token = createSessionToken({
    email,
    exp: Math.floor(Date.now() / 1000) + maxAge
  });

  return {
    name: AUTH_COOKIE_NAME,
    value: token,
    options: sessionCookieOptions(maxAge)
  };
}

export async function clearSessionCookie() {
  const store = await cookies();
  const cookie = clearSessionCookieData();
  store.set(cookie.name, cookie.value, cookie.options);
}

export function clearSessionCookieData() {
  return {
    name: AUTH_COOKIE_NAME,
    value: "",
    options: sessionCookieOptions(0)
  };
}

function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge
  } as const;
}

export async function getSession() {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new AppError("UNAUTHORIZED", "\u8bf7\u5148\u767b\u5f55\u3002");
  return session;
}

export function getAdminEmail() {
  return process.env.ADMIN_EMAIL || "admin@stocks.local";
}

function getAdminPasswordHash() {
  if (process.env.ADMIN_PASSWORD_HASH_B64) {
    return Buffer.from(process.env.ADMIN_PASSWORD_HASH_B64, "base64url").toString("utf8");
  }
  return process.env.ADMIN_PASSWORD_HASH;
}

function createSessionToken(payload: SessionPayload) {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${data}.${sign(data)}`;
}

function verifySessionToken(token: string) {
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;

  const expected = sign(data);
  const actualBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.email || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function sign(data: string) {
  return createHmac("sha256", getAuthSecret()).update(data).digest("base64url");
}

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new AppError("INTERNAL_ERROR", "\u0041\u0055\u0054\u0048\u005f\u0053\u0045\u0043\u0052\u0045\u0054 \u672a\u914d\u7f6e\u6216\u957f\u5ea6\u4e0d\u8db3\uff0c\u81f3\u5c11\u9700\u8981 32 \u4e2a\u5b57\u7b26\u3002");
  }
  return secret;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

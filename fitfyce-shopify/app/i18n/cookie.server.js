import { createCookie } from "react-router";

const COOKIE_SECRET = process.env.SESSION_SECRET || process.env.SHOPIFY_API_SECRET || "ff-locale-fallback";

export const localeCookie = createCookie("ff_locale", {
  path: "/",
  httpOnly: false, // read on the client too (e.g. for lang attribute hydration)
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365, // 1 year
  secrets: [COOKIE_SECRET],
});

export async function readLocaleCookie(request) {
  const cookieHeader = request.headers.get("Cookie");
  const value = await localeCookie.parse(cookieHeader);
  return typeof value === "string" ? value : null;
}

export async function serializeLocaleCookie(locale) {
  return localeCookie.serialize(locale);
}

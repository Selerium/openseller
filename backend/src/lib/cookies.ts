import type { CookieOptions, Response } from "express";
import { config } from "./config.ts";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * Single source of truth for auth cookie attributes.
 *
 * These five call sites used to hardcode `sameSite: "lax"`, which means changing it for a
 * cross-domain deployment meant finding every one of them.
 *
 * `sameSite` is driven by `COOKIE_SAME_SITE` rather than inferred from PROD, because the two
 * dev modes need different answers:
 * - single origin (nginx serves both, or standalone Next on :3000 proxying to the API):
 *   `lax`, no domain. Works as-is.
 * - split origins on the *same* registrable domain (api.example.com + shop.example.com):
 *   `lax` plus a shared `COOKIE_DOMAIN=.example.com`, so both hosts receive the cookie.
 * - split origins on *different* domains (Vercel + a VPS): `none` plus Secure is the only
 *   option, and the frontend then needs `credentials: "include"` (already set) and CORS with
 *   an explicit origin (already set). This is the one mode that requires an explicit choice.
 */
function base(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.cookieSameSite === "none" ? true : config.prod,
    sameSite: config.cookieSameSite,
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: "/",
  };
}

/** For endpoints that re-issue only the access token and leave the refresh token alone. */
export function setAccessCookie(res: Response, accessToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, { ...base(), maxAge: 15 * MINUTE });
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, { ...base(), maxAge: 15 * MINUTE });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base(), maxAge: 7 * DAY });
}

export function clearAuthCookies(res: Response): void {
  // clearCookie must be given the same attributes the cookie was set with, or the browser
  // keeps the original: same name, different domain, is a different cookie.
  const options = base();
  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
}
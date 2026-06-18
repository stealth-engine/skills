// apps/<app>/middleware.ts   (Next.js ≤15)
//
// On Next.js 16, rename this file to `proxy.ts` and the function
// `middleware` → `proxy`. The body is identical.
//
// This is the thin per-app wiring: it builds the config from the shared
// languages and delegates to the i18n-routing engine. Compose any app-specific
// middleware (auth, anon_id cookie, flag gating) around the i18n call here.

import { NextResponse, type NextRequest } from 'next/server';
import { supportedLanguages } from 'configs/locale';
import { createI18nMiddleware, i18nConfig } from 'i18n-routing';

const i18n = createI18nMiddleware(
  i18nConfig(supportedLanguages, {
    cookieName: 'NEXT_LOCALE',
    cookieOptions: { path: '/', sameSite: 'lax', httpOnly: false },
  })
);

export function middleware(request: NextRequest) {
  // `as any` is only needed when the app pins a different `next` than the
  // package's peer range (a types-only skew; the runtime shape is identical).
  const i18nResponse = i18n(request as any);

  // Redirect, or next() with the locale stamped on it.
  if (i18nResponse) return i18nResponse;

  // Skipped path (static/_next/api): continue your own middleware chain.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};

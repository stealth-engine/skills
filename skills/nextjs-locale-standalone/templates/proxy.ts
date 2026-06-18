// proxy.ts  (Next.js 16+)
//
// On Next.js ≤15, name this file `middleware.ts` and rename the exported
// `proxy` function to `middleware`. The body is identical.
//
// Redirects any unprefixed path to `/<locale>/…`, choosing the locale by:
//   1. NEXT_LOCALE cookie  (the toggle's last choice)
//   2. Accept-Language     (the browser)
//   3. defaultLocale
// Already-prefixed paths pass through and get the locale stamped on the response.

import { NextResponse, type NextRequest } from 'next/server';
import {
  LOCALE_COOKIE,
  canonicalizeLocale,
  defaultLocale,
  extractLocaleFromPath,
  matchAcceptLanguage,
} from '@/lib/i18n';

const HAS_FILE_EXT = /\.[a-z0-9]+(?:$|[?#])/i;

function shouldSkip(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/.well-known') ||
    pathname.startsWith('/favicon') ||
    HAS_FILE_EXT.test(pathname)
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (shouldSkip(pathname)) return;

  const current = extractLocaleFromPath(pathname);

  if (!current) {
    const fromCookie = canonicalizeLocale(
      request.cookies.get(LOCALE_COOKIE)?.value
    );
    const locale =
      fromCookie ??
      matchAcceptLanguage(request.headers.get('accept-language')) ??
      defaultLocale;

    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname}`;
    return stampLocale(NextResponse.redirect(url), request, locale);
  }

  return stampLocale(NextResponse.next(), request, current);
}

function stampLocale(
  res: NextResponse,
  req: NextRequest,
  locale: string
): NextResponse {
  res.headers.set('x-locale', locale);

  // Caching must vary by the inputs that decide the locale.
  const vary = new Set(
    (res.headers.get('Vary') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  vary.add('Accept-Language');
  vary.add('Cookie');
  res.headers.set('Vary', [...vary].join(', '));

  // Remember the active locale (also persists a toggle choice) — only on change.
  if (req.cookies.get(LOCALE_COOKIE)?.value !== locale) {
    res.cookies.set(LOCALE_COOKIE, locale, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false, // readable by client code / analytics; not a secret
      secure: req.nextUrl.protocol === 'https:',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};

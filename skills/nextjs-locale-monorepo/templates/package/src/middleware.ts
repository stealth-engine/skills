import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { I18nConfig } from './config';
import { createI18nConfig } from './config';
import {
  extractLocaleFromPath,
  getLocaleFromRequest,
  shouldSkipMiddleware,
} from './utils';

/** Stamp the active locale on a response: header, Vary, and cookie (on change). */
export function setLocaleOnResponse(
  response: NextResponse,
  request: NextRequest,
  locale: string,
  config: Required<I18nConfig>
): NextResponse {
  response.headers.set('x-locale', locale);

  // Cache must vary by the inputs that decide the locale.
  const vary = response.headers.get('Vary');
  const needed = ['Accept-Language', 'Cookie'];
  const current = new Set(
    (vary ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  );
  for (const h of needed) current.add(h);
  response.headers.set('Vary', Array.from(current).join(', '));

  const currentCookie = request.cookies.get(config.cookieName)?.value;
  if (currentCookie !== locale) {
    const isSecure = request.nextUrl.protocol === 'https:';
    response.cookies.set(config.cookieName, locale, {
      ...config.cookieOptions,
      path: config.cookieOptions.path ?? '/',
      secure: config.cookieOptions.secure ?? isSecure,
    });
  }

  return response;
}

/**
 * Build the i18n middleware. Returns a function that returns:
 *  - undefined  → skipped (static/api) — let the app's middleware continue
 *  - a redirect → unprefixed path sent to /<locale>/…
 *  - next()     → prefixed path, locale stamped on the response
 */
export function createI18nMiddleware(userConfig: I18nConfig) {
  const config = createI18nConfig(userConfig);

  return function i18nMiddleware(request: NextRequest): NextResponse | undefined {
    const { pathname } = request.nextUrl;

    if (shouldSkipMiddleware(pathname)) {
      return undefined;
    }

    const hasLocale = !!extractLocaleFromPath(pathname, config.locales);

    if (!hasLocale) {
      const locale = getLocaleFromRequest(request, config);

      // Preserve query + hash. clone() exists in the real runtime; the else
      // branch keeps unit tests (no clone) working.
      let url: URL;
      if (request.nextUrl.clone) {
        url = request.nextUrl.clone();
        url.pathname = `/${locale}${pathname}`;
      } else {
        const urlObj = new URL(request.url);
        url = new URL(`/${locale}${pathname}`, urlObj.origin);
        url.search = urlObj.search;
        url.hash = urlObj.hash;
      }

      const response = NextResponse.redirect(url.toString());
      return setLocaleOnResponse(response, request, locale, config);
    }

    const locale = extractLocaleFromPath(pathname, config.locales)!;
    const response = NextResponse.next();
    return setLocaleOnResponse(response, request, locale, config);
  };
}

/** One-shot convenience wrapper around createI18nMiddleware. */
export function i18nMiddleware(
  request: NextRequest,
  config: I18nConfig
): NextResponse | undefined {
  return createI18nMiddleware(config)(request);
}

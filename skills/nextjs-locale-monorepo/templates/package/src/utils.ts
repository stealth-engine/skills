import type { NextRequest } from 'next/server';
import type { I18nConfig } from './config';

/** Case-insensitive lookup → the canonical supported locale, or null. */
export function canonicalizeLocale(
  candidate: string | null | undefined,
  locales: string[]
): string | null {
  if (!candidate) return null;
  const lower = candidate.toLowerCase();
  return locales.find((l) => l.toLowerCase() === lower) ?? null;
}

/** First path segment, if it is a supported locale. */
export function extractLocaleFromPath(
  pathname: string,
  locales: string[]
): string | null {
  return canonicalizeLocale(pathname.split('/')[1], locales);
}

/** Locale from the Accept-Language header, or defaultLocale. */
export function detectLocaleFromHeaders(
  request: NextRequest,
  locales: string[],
  defaultLocale: string
): string {
  const acceptLanguage = request.headers.get('Accept-Language');
  if (!acceptLanguage) return defaultLocale;
  return findBestMatchingLocale(acceptLanguage, locales, defaultLocale);
}

/**
 * Resolve the locale for a request by priority:
 *   path → cookie (toggle's last choice) → Accept-Language → default.
 */
export function getLocaleFromRequest(
  request: NextRequest,
  config: I18nConfig
): string {
  const fromPath = extractLocaleFromPath(request.nextUrl.pathname, config.locales);
  if (fromPath) return fromPath;

  const cookieValue = request.cookies.get(config.cookieName || 'NEXT_LOCALE')?.value;
  const fromCookie = getLocaleFromCookie(cookieValue, config.locales);
  if (fromCookie) return fromCookie;

  return detectLocaleFromHeaders(request, config.locales, config.defaultLocale);
}

/** Skip static files, _next, API, .well-known, favicon. */
export function shouldSkipMiddleware(pathname: string): boolean {
  const hasFileExtension =
    /\.(js|jsx|ts|tsx|css|scss|sass|less|json|xml|txt|pdf|jpg|jpeg|png|gif|svg|ico|webp|avif|woff|woff2|ttf|eot|mp3|mp4|webm|wav|ogg|zip|tar|gz)(?:$|[?#])/i.test(
      pathname
    );

  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname === '/api' ||
    pathname.startsWith('/.well-known') ||
    pathname.startsWith('/favicon') ||
    hasFileExtension
  );
}

export function isValidLocale(locale: string, locales: string[]): boolean {
  return locales.some((l) => l.toLowerCase() === locale.toLowerCase());
}

/** Accept-Language → preferred locales ordered by q-value (desc). */
export function parseAcceptLanguage(acceptLanguage: string): string[] {
  return acceptLanguage
    .split(',')
    .map((lang) => {
      const [locale, q = '1'] = lang.trim().split(';q=');
      return { locale: locale.toLowerCase(), quality: parseFloat(q) };
    })
    .sort((a, b) => b.quality - a.quality)
    .map((item) => item.locale);
}

/** Best supported locale for an Accept-Language header (exact, then primary subtag). */
export function findBestMatchingLocale(
  acceptLanguage: string,
  supportedLocales: string[],
  defaultLocale: string
): string {
  const preferredLocales = parseAcceptLanguage(acceptLanguage);

  for (const preferred of preferredLocales) {
    const canonical = canonicalizeLocale(preferred, supportedLocales);
    if (canonical) return canonical;
  }

  for (const preferred of preferredLocales) {
    const langCode = preferred.split('-')[0].toLowerCase();
    const match = supportedLocales.find((locale) => {
      const localeLower = locale.toLowerCase();
      return localeLower === langCode || localeLower.startsWith(`${langCode}-`);
    });
    if (match) return match;
  }

  return defaultLocale;
}

export function createLocalizedUrl(
  baseUrl: string,
  locale: string,
  pathname: string = '/'
): string {
  const url = new URL(baseUrl);
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  return url.toString();
}

export function removeLocaleFromPath(pathname: string, locales: string[]): string {
  const locale = extractLocaleFromPath(pathname, locales);
  // `locale` is canonical (lowercase) but the URL segment may be any case
  // (`/EN-HK/about`), so match the leading segment case-insensitively and only
  // at a `/` boundary (never mid-path).
  if (locale) return pathname.replace(new RegExp(`^/${locale}(?=/|$)`, 'i'), '') || '/';
  return pathname;
}

export function getLocaleFromCookie(
  cookieValue: string | undefined,
  locales: string[]
): string | null {
  return canonicalizeLocale(cookieValue, locales);
}

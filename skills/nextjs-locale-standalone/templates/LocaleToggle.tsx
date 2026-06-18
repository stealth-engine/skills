// components/LocaleToggle.tsx
'use client';

import { useRouter, usePathname } from 'next/navigation';
import { supportedLanguages } from '@/lib/i18n';
import { useCurrentLocale } from '@/app/locale-provider';

export function LocaleToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const current = useCurrentLocale();

  function switchTo(locale: string) {
    if (locale === current) return;

    const segments = (pathname ?? '/').split('/').filter(Boolean);
    // Match the first segment case-insensitively (the proxy/layout accept
    // `/EN-HK/…`), else `/EN-HK/x` would gain a second prefix: `/zh-hk/EN-HK/x`.
    const first = segments[0]?.toLowerCase();
    if (supportedLanguages.some((l) => l.id === first)) {
      segments[0] = locale; // replace existing locale prefix
    } else {
      segments.unshift(locale); // unprefixed path — add one
    }

    // Preserve query + hash across the switch.
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    router.push(`/${segments.join('/')}${search}${hash}`);

    // No need to set the cookie here: the proxy writes NEXT_LOCALE on this
    // navigation (a now-prefixed path), so the choice is remembered.
  }

  return (
    <div className="flex gap-2">
      {supportedLanguages.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => switchTo(l.id)}
          aria-current={l.id === current ? 'true' : undefined}
          className={l.id === current ? 'font-semibold underline' : ''}
        >
          {l.title}
        </button>
      ))}
    </div>
  );
}

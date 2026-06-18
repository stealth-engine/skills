// apps/<app>/components/LocaleToggle.tsx
'use client';

import { useRouter, usePathname } from 'next/navigation';
import { supportedLanguages } from 'configs/locale';
import { useCurrentLocale } from 'i18n-routing/client';

export function LocaleToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const current = useCurrentLocale();

  function switchTo(locale: string) {
    if (locale === current) return;

    const segments = (pathname ?? '/').split('/').filter(Boolean);
    if (supportedLanguages.some((l) => l.id === segments[0])) {
      segments[0] = locale; // replace existing prefix
    } else {
      segments.unshift(locale); // unprefixed — add one
    }

    const search = typeof window !== 'undefined' ? window.location.search : '';
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    router.push(`/${segments.join('/')}${search}${hash}`);

    // The middleware writes NEXT_LOCALE on this navigation, so the choice sticks.
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

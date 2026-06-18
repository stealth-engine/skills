// app/[locale]/layout.tsx
//
// This is the ROOT layout (renders <html>/<body>) — there is no app/layout.tsx.
// Valid as long as every page lives under app/[locale]/.

import { notFound } from 'next/navigation';
import { supportedLanguages, isValidLocale } from '@/lib/i18n';
import { LocaleProvider } from '@/app/locale-provider';
import '../globals.css';

// Pre-render one tree per locale.
export function generateStaticParams() {
  return supportedLanguages.map((l) => ({ locale: l.id }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isValidLocale(locale)) notFound();

  return (
    <html lang={locale}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}

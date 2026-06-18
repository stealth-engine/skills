// apps/<app>/app/[locale]/layout.tsx
//
// Root layout (renders <html>/<body>) — there is no app/layout.tsx; every page
// lives under app/[locale]/. The provider comes from the *client* entry.

import { notFound } from 'next/navigation';
import { supportedLanguages } from 'configs/locale';
import { LocaleProvider } from 'i18n-routing/client';
import '../globals.css';

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
  if (!supportedLanguages.some((l) => l.id === locale)) notFound();

  return (
    <html lang={locale}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}

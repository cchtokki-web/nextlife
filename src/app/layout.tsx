import type { Metadata } from 'next';
import './globals.css';

import AuthProvider from "@/web/components/providers/AuthProvider";
import AnalyticsTracker from "@/web/components/AnalyticsTracker";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://next.tokkilab.com'),
  title: 'NextLife - 은퇴 자산',
  description: '투자자산, 사적연금, 국민연금, 기타 소득을 기반으로 조기 은퇴(FIRE) 가능 시점과 노후 자산 고갈 위험을 정밀하게 연산해주는 은퇴 자산 대시보드 시뮬레이터',
  keywords: ['은퇴 시뮬레이터', 'FIRE 계산기', '노후 자산 계산', '국민연금', '사적연금', 'IRP', '배당 재투자', '금융소득종합과세'],
  authors: [{ name: 'Antigravity' }],
  verification: {
    google: "fwRpzqcz6f0NJTc6d_8tmtKKKk_iVqn8j9DI7RehFZo"
  },
  openGraph: {
    title: 'NextLife - 은퇴 자산 시뮬레이터',
    description: '투자자산, 사적연금, 국민연금, 기타 소득을 기반으로 조기 은퇴(FIRE) 가능 시점과 노후 자산 고갈 위험을 정밀하게 연산해 보세요.',
    url: '/',
    siteName: 'NextLife',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'NextLife - 은퇴 자산 시뮬레이터',
      },
    ],
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NextLife - 은퇴 자산 시뮬레이터',
    description: '투자자산, 사적연금, 국민연금, 기타 소득을 기반으로 조기 은퇴(FIRE) 가능 시점과 노후 자산 고갈 위험을 정밀하게 연산해 보세요.',
    images: ['/og-image.png'],
  },
};

import { ThemeProvider } from "@/web/components/providers/ThemeProvider";

export default function RootLayout({
  children,
  ...props
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const savedTheme = localStorage.getItem('theme');
                  if (savedTheme === 'light' || savedTheme === 'dark') {
                    document.documentElement.setAttribute('data-theme', savedTheme);
                  } else {
                    document.documentElement.setAttribute('data-theme', 'dark');
                  }
                } catch (e) {}
              })();
            `
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <AuthProvider>
            <AnalyticsTracker />
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

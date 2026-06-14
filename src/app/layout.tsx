import type { Metadata } from 'next';
import './globals.css';

import AuthProvider from "@/web/components/providers/AuthProvider";

export const metadata: Metadata = {
  title: 'NextLife - 은퇴 자산 및 월 소득 시뮬레이터',
  description: '투자자산, 사적연금, 국민연금, 기타 소득을 기반으로 조기 은퇴(FIRE) 가능 시점과 노후 자산 고갈 위험을 정밀하게 연산해주는 은퇴 자산 대시보드 시뮬레이터',
  keywords: ['은퇴 시뮬레이터', 'FIRE 계산기', '노후 자산 계산', '국민연금', '사적연금', 'IRP', '배당 재투자', '금융소득종합과세'],
  authors: [{ name: 'Antigravity' }],
};

export default function RootLayout({
  children,
  ...props
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}

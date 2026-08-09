"use client";

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { isDevMode } from '@/core/utils/isDevMode';

export function EmailMigrationGate({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isDevMode() || status !== 'authenticated' || session?.user?.provider !== 'kakao') return;
    if (pathname === '/migrate-email') return;

    const controller = new AbortController();
    fetch('/api/user/email-migration/status', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data?.required) router.replace('/migrate-email');
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Failed to check email migration status:', error);
        }
      });
    return () => controller.abort();
  }, [pathname, router, session?.user?.provider, status]);

  return children;
}

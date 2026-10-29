import type { Session } from 'next-auth';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { isDevMode } from '@/core/utils/isDevMode';

const DEV_USER = {
  id: 'dev-user-id',
  name: 'Dev User',
  email: 'dev@example.com',
  tier: 'premium',
};

/** 개발 모드에서는 브라우저 로그인 없이 앱 전용 개발 세션을 반환한다. */
export async function getAppSession(): Promise<Session | null> {
  if (isDevMode()) {
    return {
      user: DEV_USER,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  return getServerSession(authOptions);
}

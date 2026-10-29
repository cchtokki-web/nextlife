import { afterEach, describe, expect, test, vi } from 'vitest';
import { isDevMode } from '@/core/utils/isDevMode';

vi.mock('next-auth/next', () => ({ getServerSession: vi.fn() }));
vi.mock('@/core/utils/authOptions', () => ({ authOptions: {} }));

import { getServerSession } from 'next-auth/next';
import { getAppSession } from '@/core/utils/getAppSession';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('개발 세션 보호', () => {
  test('개발 환경에서 로그인 없이 개발 세션을 사용한다', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_DEV_MODE', 'false');
    expect(isDevMode()).toBe(true);
    expect(await getAppSession()).toMatchObject({ user: { id: 'dev-user-id' } });
    expect(getServerSession).not.toHaveBeenCalled();
  });

  test('운영 환경에서는 개발 플래그가 켜져도 실제 세션만 사용한다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_DEV_MODE', 'true');
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never);
    expect(isDevMode()).toBe(false);
    expect(await getAppSession()).toBeNull();
    expect(getServerSession).toHaveBeenCalledOnce();
  });
});

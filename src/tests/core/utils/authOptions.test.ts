import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextAuthOptions } from 'next-auth';

// authOptions는 모듈 로드 시점에 isDevMode()를 읽어 provider 목록·쿠키 설정·NEXTAUTH_URL을
// 확정한다. 따라서 모드별 동작을 보려면 env를 바꾼 뒤 모듈을 새로 import해야 한다.
vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock('@next-auth/prisma-adapter', () => ({
  PrismaAdapter: () => ({}),
}));

vi.mock('bcrypt', () => ({
  default: { compare: vi.fn(async () => false) },
}));

async function loadAuthOptions(devMode: boolean): Promise<NextAuthOptions> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', devMode ? 'development' : 'production');
  vi.stubEnv('NEXT_PUBLIC_DEV_MODE', devMode ? 'true' : 'false');
  const mod = await import('@/core/utils/authOptions');
  return mod.authOptions;
}

// CredentialsProvider의 authorize를 꺼낸다. next-auth가 감싸므로 options 안에 들어 있다.
type AuthorizeFn = (credentials: Record<string, string> | undefined) => Promise<unknown>;
function credentialsAuthorize(options: NextAuthOptions): AuthorizeFn {
  const provider = options.providers.find((p) => p.id === 'credentials');
  expect(provider, 'credentials provider가 사라졌다').toBeDefined();
  return (provider as unknown as { options: { authorize: AuthorizeFn } }).options.authorize;
}

beforeEach(() => {
  vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// 개발 모드 분기는 자격증명 검사를 통째로 건너뛰고(아무 이메일·비밀번호나 premium 세션),
// Kakao provider를 제거하고, 쿠키 secure 플래그를 내린다. 게이트가 한 번 잘못 열리면
// 그것이 곧 완전한 인증 우회이므로, 프로덕션 빌드에서 그 분기가 죽는다는 사실을 고정한다.
describe('authOptions — 프로덕션 모드', () => {
  test('NEXT_PUBLIC_DEV_MODE가 true여도 프로덕션 빌드에서는 dev 우회가 죽는다', async () => {
    vi.resetModules();
    // 배포 환경에 .env가 섞여 들어간 상황을 그대로 재현한다.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_DEV_MODE', 'true');
    const { authOptions } = await import('@/core/utils/authOptions');

    const authorize = credentialsAuthorize(authOptions);

    // dev 우회가 살아 있다면 아무 값이나 premium 사용자로 통과시킨다.
    await expect(authorize({ email: 'anything', password: 'anything' }))
      .rejects.toThrow();
  });

  test('Kakao 로그인 provider가 존재한다', async () => {
    const authOptions = await loadAuthOptions(false);

    expect(authOptions.providers.map((p) => p.id)).toContain('kakao');
  });

  test('쿠키 secure 설정을 next-auth 기본값에 맡긴다(강제로 내리지 않는다)', async () => {
    const authOptions = await loadAuthOptions(false);

    expect(authOptions.useSecureCookies).toBeUndefined();
    expect(authOptions.cookies).toBeUndefined();
  });

  test('자격증명이 비어 있으면 거부한다', async () => {
    const authOptions = await loadAuthOptions(false);
    const authorize = credentialsAuthorize(authOptions);

    await expect(authorize(undefined)).rejects.toThrow('이메일과 비밀번호를 모두 입력해주세요.');
  });

  test('가입되지 않은 이메일이면 거부한다', async () => {
    const authOptions = await loadAuthOptions(false);
    const { prisma } = await import('@/infrastructure/db/prisma');
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const authorize = credentialsAuthorize(authOptions);

    await expect(authorize({ email: 'nobody@example.com', password: 'pw' }))
      .rejects.toThrow('가입되지 않은 이메일이거나 비밀번호가 틀렸습니다.');
  });

  test('세션 전략은 jwt다(middleware의 getToken이 이 전제 위에서 동작한다)', async () => {
    const authOptions = await loadAuthOptions(false);

    expect(authOptions.session?.strategy).toBe('jwt');
  });
});

describe('authOptions — 개발 모드', () => {
  test('개발 편의를 위한 우회는 그대로 동작한다', async () => {
    const authOptions = await loadAuthOptions(true);
    const authorize = credentialsAuthorize(authOptions);

    await expect(authorize({ email: 'dev', password: 'dev' }))
      .resolves.toMatchObject({ email: 'dev@example.com', tier: 'premium' });
  });

  test('쿠키 secure를 내려 http://localhost에서도 세션이 유지된다', async () => {
    const authOptions = await loadAuthOptions(true);

    expect(authOptions.useSecureCookies).toBe(false);
    expect(authOptions.cookies?.sessionToken?.options?.secure).toBe(false);
  });
});

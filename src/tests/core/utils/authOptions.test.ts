import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextAuthOptions } from 'next-auth';

// authOptions는 모듈 로드 시점에 isDevMode()를 읽어 provider 목록·쿠키 설정·NEXTAUTH_URL을
// 확정한다. 따라서 모드별 동작을 보려면 env를 바꾼 뒤 모듈을 새로 import해야 한다.
vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    scenario: { deleteMany: vi.fn() },
    verificationToken: { deleteMany: vi.fn() },
    $transaction: vi.fn(async () => []),
  },
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
  vi.stubEnv('NEXTAUTH_SECRET', 'test-only-secret-with-more-than-32-characters');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// 개발 모드 분기는 자격증명 검사를 통째로 건너뛰고(아무 이메일·보안키나 premium 세션),
// 쿠키 secure 플래그를 내린다. 게이트가 한 번 잘못 열리면
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
    await expect(authorize({ email: 'anything', securityKey: 'anything' }))
      .rejects.toThrow();
  });

  test('이메일 credentials provider만 존재한다', async () => {
    const authOptions = await loadAuthOptions(false);

    expect(authOptions.providers.map((p) => p.id)).toEqual(['credentials']);
  });

  test('쿠키 secure 설정을 next-auth 기본값에 맡긴다(강제로 내리지 않는다)', async () => {
    const authOptions = await loadAuthOptions(false);

    expect(authOptions.useSecureCookies).toBeUndefined();
    expect(authOptions.cookies).toBeUndefined();
  });

  test('자격증명이 비어 있으면 거부한다', async () => {
    const authOptions = await loadAuthOptions(false);
    const authorize = credentialsAuthorize(authOptions);

    await expect(authorize(undefined)).rejects.toThrow('이메일과 보안키를 모두 입력해 주세요.');
  });

  test('가입되지 않은 이메일이면 거부한다', async () => {
    const authOptions = await loadAuthOptions(false);
    const { prisma } = await import('@/infrastructure/db/prisma');
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const authorize = credentialsAuthorize(authOptions);

    await expect(authorize({ email: 'nobody@example.com', securityKey: 'ABC234' }))
      .rejects.toThrow('가입되지 않은 이메일이거나 보안키가 올바르지 않습니다.');
  });

  test('이메일 보안키가 맞으면 이메일 인증을 완료하고 로그인한다', async () => {
    const authOptions = await loadAuthOptions(false);
    const { prisma } = await import('@/infrastructure/db/prisma');
    const bcrypt = (await import('bcrypt')).default;
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      securityKeyHash: 'hashed-key',
      securityKeyResetPending: false,
      emailVerified: null,
      name: null,
      image: null,
      tier: 'basic',
      simulationData: null,
      e2eeEnabledAt: null,
      lastActiveScenarioId: null,
      compareScenarioIds: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);

    const authorize = credentialsAuthorize(authOptions);
    await expect(authorize({ email: 'USER@EXAMPLE.COM', securityKey: 'abc234' }))
      .resolves.toMatchObject({ id: 'user-1', email: 'user@example.com' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerified: expect.any(Date) },
    });
  });

  test('재발급한 새 키가 맞을 때만 기존 데이터를 트랜잭션으로 초기화한다', async () => {
    const authOptions = await loadAuthOptions(false);
    const { prisma } = await import('@/infrastructure/db/prisma');
    const bcrypt = (await import('bcrypt')).default;
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      securityKeyHash: 'new-hash',
      securityKeyResetPending: true,
      emailVerified: new Date(),
      name: null,
      image: null,
      tier: 'basic',
      simulationData: null,
      e2eeEnabledAt: new Date(),
      lastActiveScenarioId: null,
      compareScenarioIds: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);

    await credentialsAuthorize(authOptions)({ email: 'user@example.com', securityKey: 'NEW234' });

    expect(prisma.scenario.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        securityKeyResetPending: false,
        simulationData: null,
        e2eeEnabledAt: null,
        lastActiveScenarioId: null,
        compareScenarioIds: null,
      },
    });
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: 'user@example.com' },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  test('세션 전략은 jwt다(proxy의 getToken이 이 전제 위에서 동작한다)', async () => {
    const authOptions = await loadAuthOptions(false);

    expect(authOptions.session?.strategy).toBe('jwt');
  });

});

describe('authOptions — 개발 모드', () => {
  test('개발 편의를 위한 우회는 그대로 동작한다', async () => {
    const authOptions = await loadAuthOptions(true);
    const authorize = credentialsAuthorize(authOptions);

    await expect(authorize({ email: 'dev', securityKey: 'dev' }))
      .resolves.toMatchObject({ email: 'dev@example.com', tier: 'premium' });
  });

  test('쿠키 secure를 내려 http://localhost에서도 세션이 유지된다', async () => {
    const authOptions = await loadAuthOptions(true);

    expect(authOptions.useSecureCookies).toBe(false);
    expect(authOptions.cookies?.sessionToken?.options?.secure).toBe(false);
  });
});

// **redirect 콜백은 반드시 절대 URL을 돌려줘야 한다.**
//
// next-auth 클라이언트의 signIn()이 응답의 url을 `new URL(...)`로 파싱한다. 상대 경로를
// 주면 거기서 TypeError가 나고, 개발 모드 자동 로그인이 "자동 로그인 중 오류가 발생했습니다"
// 화면에 멈춘다 — 서버 측 인증은 정상인데(HTTP 200) 브라우저에서 진입이 통째로 막혔다.
//
// 그런데 origin을 NEXTAUTH_URL에 그대로 맡길 수도 없다. 그 값은 모듈 로드 시점에 한 번
// 정해지는데(기본 http://localhost:3000) dev 서버는 다른 포트로 띄우는 일이 흔하고,
// 그러면 로그인 후 매번 죽은 포트로 튕긴다. 예전에 이 분기가 상대 경로를 돌려주던 이유가
// 정확히 그것이었다 — 한쪽을 고치려다 다른 쪽을 깨뜨린 자리다.
describe('authOptions — redirect 콜백', () => {
  type RedirectFn = (params: { url: string; baseUrl: string }) => Promise<string>;
  const redirectOf = (options: NextAuthOptions): RedirectFn =>
    options.callbacks!.redirect as unknown as RedirectFn;

  const BASE = 'http://localhost:3000';

  describe('개발 모드', () => {
    test('상대 경로를 받아도 절대 URL을 돌려준다', async () => {
      const redirect = redirectOf(await loadAuthOptions(true));

      const result = await redirect({ url: '/simulator', baseUrl: BASE });

      // 이 한 줄이 결함의 정의다. 예전에는 '/simulator'를 그대로 돌려줬다.
      expect(() => new URL(result)).not.toThrow();
      expect(new URL(result).pathname).toBe('/simulator');
    });

    test('절대 URL을 받아도 경로를 보존한 절대 URL을 돌려준다', async () => {
      const redirect = redirectOf(await loadAuthOptions(true));

      const result = await redirect({ url: 'http://localhost:9999/simulator?a=1#b', baseUrl: BASE });

      const parsed = new URL(result);
      expect(parsed.pathname).toBe('/simulator');
      expect(parsed.search).toBe('?a=1');
      expect(parsed.hash).toBe('#b');
    });

    test('실제 실행 중인 포트(PORT)를 origin으로 쓴다', async () => {
      // dev 서버를 3000이 아닌 포트로 띄우면 next dev가 process.env.PORT에 실제 포트를
      // 넣어 준다. NEXTAUTH_URL(baseUrl)만 믿으면 로그인 후 죽은 포트로 보내게 된다.
      vi.stubEnv('PORT', '3101');
      const redirect = redirectOf(await loadAuthOptions(true));

      const result = await redirect({ url: '/simulator', baseUrl: BASE });

      expect(new URL(result).port).toBe('3101');
    });

    test('DEV_NEXTAUTH_URL을 지정했으면 그 값이 PORT보다 우선한다', async () => {
      // 터널·호스트 별칭을 쓰는 경우다. 명시적으로 지정한 값을 포트 추론이 덮으면 안 된다.
      vi.stubEnv('PORT', '3101');
      vi.stubEnv('DEV_NEXTAUTH_URL', 'http://my-tunnel.test');
      const redirect = redirectOf(await loadAuthOptions(true));

      const result = await redirect({ url: '/simulator', baseUrl: BASE });

      expect(new URL(result).origin).toBe('http://my-tunnel.test');
    });

    test('파싱할 수 없는 값이면 루트로 보낸다', async () => {
      const redirect = redirectOf(await loadAuthOptions(true));

      const result = await redirect({ url: 'not a url', baseUrl: BASE });

      expect(new URL(result).pathname).toBe('/');
    });

    test.each(['//evil.com', '/\\evil.com', '//evil.com/steal'])(
      '프로토콜 상대 URL(%s)은 외부로 나가지 않는다',
      async (hostile) => {
        // `startsWith('/')`만 보면 통과하는 형태다. 앞에 origin을 붙이므로 실제로는 같은
        // 출처의 경로가 되지만, 그 안전성을 읽을 때마다 다시 따지게 두지 않는다.
        vi.stubEnv('PORT', '3102');
        const redirect = redirectOf(await loadAuthOptions(true));

        const result = await redirect({ url: hostile, baseUrl: BASE });

        expect(new URL(result).origin).toBe('http://localhost:3102');
        expect(new URL(result).pathname).toBe('/');
      }
    );
  });

  describe('프로덕션 모드', () => {
    test('같은 출처의 상대 경로는 baseUrl을 붙여 돌려준다', async () => {
      const redirect = redirectOf(await loadAuthOptions(false));

      expect(await redirect({ url: '/simulator', baseUrl: BASE })).toBe(`${BASE}/simulator`);
    });

    test('다른 출처로 나가는 URL은 baseUrl로 되돌린다 (오픈 리다이렉트 방지)', async () => {
      const redirect = redirectOf(await loadAuthOptions(false));

      expect(await redirect({ url: 'https://evil.com/steal', baseUrl: BASE })).toBe(BASE);
    });
  });
});

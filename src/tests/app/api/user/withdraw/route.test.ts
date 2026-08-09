import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// authOptions는 next-auth adapter/bcrypt까지 끌고 오므로 더미로 바꾼다.
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));
vi.mock('@/core/utils/authOptions', () => ({
  authOptions: {},
}));

vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    verificationToken: {
      deleteMany: vi.fn(),
    },
    account: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/core/utils/rateLimiter', () => ({
  isRateLimited: vi.fn(() => false),
}));

// @/infrastructure/kakao/*는 일부러 목하지 않는다. unlink가 실제로 어느 URL을 어떤 헤더로
// 부르는지, 401에서 리프레시 후 재시도하는지가 이 파일이 지켜야 할 동작이다.
import type { Session } from 'next-auth';
import { getServerSession } from 'next-auth/next';
import { prisma } from '@/infrastructure/db/prisma';
import { isRateLimited } from '@/core/utils/rateLimiter';
import { POST } from '@/app/api/user/withdraw/route';

const USER_ID = 'user-1';

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedFindUnique = vi.mocked(prisma.user.findUnique);
const mockedDeleteMany = vi.mocked(prisma.user.deleteMany);
const mockedTokenDeleteMany = vi.mocked(prisma.verificationToken.deleteMany);
const mockedTransaction = vi.mocked(prisma.$transaction);
const mockedIsRateLimited = vi.mocked(isRateLimited);

function makeRequest(body: unknown = { confirm: '탈퇴' }) {
  return new Request('http://localhost/api/user/withdraw', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// userId를 null로 주면 "세션은 있는데 id가 없는" 상태. 기본값 문법(`= USER_ID`)을 쓰면
// undefined를 넘겼을 때 기본값이 발동해 그 경우를 만들 수 없다.
function session(userId: string | null = USER_ID) {
  return { user: userId ? { id: userId } : {} } as unknown as Session;
}

const kakaoAccount = {
  id: 'acc-1',
  provider: 'kakao',
  access_token: 'valid-token',
  refresh_token: 'refresh-token',
  expires_at: 1,
};

/** findUnique가 돌려줄 사용자. accounts는 kakao로 필터된 결과를 흉내낸다. */
function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: 'a@b.com',
    accounts: [kakaoAccount],
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof prisma.user.findUnique>>;
}

function kakaoResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetServerSession.mockResolvedValue(session());
  mockedIsRateLimited.mockReturnValue(false);
  mockedFindUnique.mockResolvedValue(userRow());
  // 배열 형태 $transaction. 모델 메서드는 그대로 호출되므로 인자 검증이 살아 있다.
  mockedTransaction.mockImplementation(async (ops: unknown) => Promise.all(ops as Promise<unknown>[]));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  vi.restoreAllMocks();
});

describe('POST /api/user/withdraw', () => {
  test('세션이 없으면 401을 반환한다', async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  test('session.user.id가 없으면 401을 반환한다', async () => {
    mockedGetServerSession.mockResolvedValue(session(null));

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  test('요청 제한에 걸리면 429를 반환하고 아무것도 삭제하지 않는다', async () => {
    mockedIsRateLimited.mockReturnValue(true);

    const res = await POST(makeRequest());

    expect(res.status).toBe(429);
    expect(mockedIsRateLimited).toHaveBeenCalledWith('withdraw:user-1', 3, 10 * 60 * 1000);
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  // 프리페치나 복붙한 fetch가 계정을 사고로 날리지 못하게 하는 의도 확인이다.
  test('확인 값이 없거나 다르면 400을 반환하고 아무것도 삭제하지 않는다', async () => {
    const missing = await POST(makeRequest({}));
    expect(missing.status).toBe(400);

    const wrong = await POST(makeRequest({ confirm: '탈퇴합니다' }));
    expect(wrong.status).toBe(400);

    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  // 순서가 뒤집히면(삭제 먼저) cascade가 Account 행을 지워 토큰이 사라지고, 카카오 연결은
  // 아무도 다시 끊을 수 없다. "둘 다 호출됐다"만 보면 뒤집어도 통과하므로 순서를 검증한다.
  test('카카오 계정이 있으면 unlink를 호출한 뒤 사용자를 삭제한다', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(kakaoResponse(200, { id: 1 }));

    const res = await POST(makeRequest());
    const bodyJson = await res.json();

    expect(res.status).toBe(200);
    expect(bodyJson).toEqual({ success: true, kakaoUnlinked: true });
    expect(fetchSpy.mock.calls[0][0]).toBe('https://kapi.kakao.com/v1/user/unlink');
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer valid-token',
    });
    expect(fetchSpy.mock.invocationCallOrder[0])
      .toBeLessThan(mockedDeleteMany.mock.invocationCallOrder[0]);
  });

  test('unlink가 실패해도 사용자 삭제는 진행하고 success를 반환한다', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(kakaoResponse(400, { code: -1 }));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, kakaoUnlinked: false });
    expect(mockedDeleteMany).toHaveBeenCalledWith({ where: { id: USER_ID } });
  });

  // unlinkKakaoAccount에 try/catch가 없으면 DNS 한 번 흔들린 것으로 탈퇴 전체가 500이 된다.
  test('unlink 요청이 네트워크 오류로 던져도 삭제는 진행된다', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ENOTFOUND'));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, kakaoUnlinked: false });
    expect(mockedDeleteMany).toHaveBeenCalled();
  });

  // 카카오 액세스 토큰은 6시간, 세션 JWT는 30일이다. 탈퇴하는 사용자는 대개 죽은 토큰을
  // 들고 있으므로 이게 예외가 아니라 흔한 경로다. 401에서 포기하면 대다수 unlink가 no-op이 된다.
  test('액세스 토큰이 만료되면(401) 리프레시 후 unlink를 재시도한다', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(kakaoResponse(401, { code: -401 }))
      .mockResolvedValueOnce(kakaoResponse(200, { access_token: 'new-token', expires_in: 21599 }))
      .mockResolvedValueOnce(kakaoResponse(200, { id: 1 }));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, kakaoUnlinked: true });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[1][0]).toBe('https://kauth.kakao.com/oauth/token');
    expect((fetchSpy.mock.calls[2][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer new-token',
    });
    expect(vi.mocked(prisma.account.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acc-1' },
        data: expect.objectContaining({ access_token: 'new-token' }),
      })
    );
  });

  test('refresh_token이 없으면 unlink 401에서 재시도하지 않고 삭제만 진행한다', async () => {
    mockedFindUnique.mockResolvedValue(
      userRow({ accounts: [{ ...kakaoAccount, refresh_token: null }] })
    );
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(kakaoResponse(401, { code: -401 }));

    const res = await POST(makeRequest());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, kakaoUnlinked: false });
  });

  test('카카오 계정이 없으면(이메일 가입) unlink를 호출하지 않고 삭제한다', async () => {
    mockedFindUnique.mockResolvedValue(userRow({ accounts: [] }));
    const fetchSpy = vi.spyOn(global, 'fetch');

    const res = await POST(makeRequest());

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(mockedDeleteMany).toHaveBeenCalled();
  });

  // VerificationToken은 User와 관계가 없어 cascade에 걸리지 않는다. 남기면 같은 이메일로
  // 재가입했을 때 예전 인증/비밀번호 재설정 토큰이 그대로 통한다.
  test('사용자와 이메일 인증 토큰을 한 트랜잭션으로 삭제한다', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(kakaoResponse(200, { id: 1 }));

    await POST(makeRequest());

    expect(mockedTransaction).toHaveBeenCalledTimes(1);
    expect(mockedDeleteMany).toHaveBeenCalledWith({ where: { id: USER_ID } });
    expect(mockedTokenDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { identifier: { startsWith: `email-migration:${USER_ID}:` } },
          { identifier: 'a@b.com' },
        ],
      },
    });
  });

  // 카카오 스코프에 account_email이 없어 카카오 사용자는 전원 email이 null이다.
  // 이메일이 없어도 전환 도중 발급된 인증번호는 사용자 ID 접두사로 찾아 삭제한다.
  test('이메일이 없는 카카오 계정도 전환 인증 토큰을 삭제한다', async () => {
    mockedFindUnique.mockResolvedValue(userRow({ email: null }));
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(kakaoResponse(200, { id: 1 }));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockedDeleteMany).toHaveBeenCalled();
    expect(mockedTokenDeleteMany).toHaveBeenCalledWith({
      where: { OR: [{ identifier: { startsWith: `email-migration:${USER_ID}:` } }] },
    });
  });

  test('이미 삭제된 사용자면 200 success를 반환하고 unlink도 삭제도 하지 않는다', async () => {
    mockedFindUnique.mockResolvedValue(null);
    const fetchSpy = vi.spyOn(global, 'fetch');

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, kakaoUnlinked: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  // 500을 success로 삼키면 사용자는 사라졌다고 믿은 채 계정을 남겨 둔다.
  test('DB 삭제가 실패하면 500을 반환한다', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(kakaoResponse(200, { id: 1 }));
    mockedTransaction.mockRejectedValue(new Error('db down'));

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBeTruthy();
  });
});

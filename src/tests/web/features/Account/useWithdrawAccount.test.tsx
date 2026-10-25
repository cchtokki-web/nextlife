import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// 이 파일만 next-auth를 목한다 — 컴포넌트 테스트가 목 없이 돌 수 있도록 시퀀스를 훅으로
// 분리해 둔 이유가 이것이다.
const sessionState = { data: null as unknown };
const signOut = vi.fn(async (_options?: { callbackUrl?: string }) => undefined);
vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
  signOut: (options?: { callbackUrl?: string }) => signOut(options),
}));

import { useWithdrawAccount } from '@/web/features/Account/useWithdrawAccount';
import { e2eeKeyName, SIMULATOR_PARAMS_KEY } from '@/infrastructure/storage/storageKeys';

const USER_ID = 'user-1';

function signedIn() {
  sessionState.data = { user: { id: USER_ID } };
}

function respond(status: number, body: unknown = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response));
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  signOut.mockClear();
  signedIn();
  localStorage.setItem(e2eeKeyName(USER_ID), 'AAA111');
  localStorage.setItem(SIMULATOR_PARAMS_KEY, '{"x":1}');
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

function setup(opts?: { onBeforeSignOut?: () => void }) {
  const { result } = renderHook(() => useWithdrawAccount(opts));
  return result;
}

describe('useWithdrawAccount', () => {
  test('성공하면 확인 문구를 담아 탈퇴를 요청한다', async () => {
    const fetchMock = respond(200, { success: true });
    vi.stubGlobal('fetch', fetchMock);
    const result = setup();

    await act(async () => { await result.current(); });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/user/withdraw');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ confirm: '탈퇴' });
  });

  // 최악의 버그: 서버에 데이터가 남아 있는데 그것을 열 열쇠만 사라진 상태.
  // 계정은 살아 있고 아무도 못 연다 — 탈퇴보다 나쁘다.
  test('서버 삭제가 실패하면 이 브라우저의 보안키를 지우지 않는다', async () => {
    vi.stubGlobal('fetch', respond(500, { error: '서버 오류' }));
    const result = setup();

    let outcome!: Awaited<ReturnType<ReturnType<typeof useWithdrawAccount>>>;
    await act(async () => { outcome = await result.current(); });

    expect(outcome.ok).toBe(false);
    expect(localStorage.getItem(e2eeKeyName(USER_ID))).toBe('AAA111');
    expect(localStorage.getItem(SIMULATOR_PARAMS_KEY)).toBe('{"x":1}');
  });

  // signOut 뒤에는 세션이 없어 `nextlife_e2ee_key_${userId}`라는 키 이름조차 만들 수 없다.
  test('로컬 데이터를 지운 뒤에 signOut을 부른다', async () => {
    vi.stubGlobal('fetch', respond(200, { success: true }));
    let keyAtSignOut: string | null = 'not-called';
    signOut.mockImplementation(async () => {
      keyAtSignOut = localStorage.getItem(e2eeKeyName(USER_ID));
      return undefined;
    });
    const result = setup();

    await act(async () => { await result.current(); });

    expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/' });
    expect(keyAtSignOut).toBeNull();
  });

  // finally { signOut() }이면 계정이 살아 있는데 로그아웃되어, 실패가 성공처럼 보인다.
  test('실패하면 signOut을 부르지 않는다', async () => {
    vi.stubGlobal('fetch', respond(401));
    const result = setup();

    await act(async () => { await result.current(); });

    expect(signOut).not.toHaveBeenCalled();
  });

  test('상태 코드마다 다른 안내를 준다', async () => {
    const messages: string[] = [];
    for (const [status, body] of [[401, {}], [429, {}], [500, { error: '서버가 준 사유' }]] as const) {
      vi.stubGlobal('fetch', respond(status, body));
      const result = setup();
      await act(async () => {
        const outcome = await result.current();
        if (!outcome.ok) messages.push(outcome.message);
      });
    }

    expect(messages[0]).toContain('다시 로그인');
    expect(messages[1]).toContain('너무 많은 요청');
    expect(messages[2]).toBe('서버가 준 사유');
    // 사용자가 "절반쯤 일어난 것인지" 궁금해하지 않도록 계정 상태를 명시한다.
    expect(messages[0]).toContain('삭제되지 않았습니다');
    expect(messages[1]).toContain('삭제되지 않았습니다');
  });

  test('네트워크 오류에도 계정이 남아 있다고 알리고 아무것도 지우지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const result = setup();

    let outcome!: Awaited<ReturnType<ReturnType<typeof useWithdrawAccount>>>;
    await act(async () => { outcome = await result.current(); });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('삭제되지 않았습니다');
    expect(localStorage.getItem(e2eeKeyName(USER_ID))).toBe('AAA111');
    expect(signOut).not.toHaveBeenCalled();
  });

  // 2xx인데 본문 파싱이 실패했다고 "실패"로 표시하면, 이미 삭제된 계정에 대해 사용자가
  // 재시도하고 그 재시도는 401을 맞는다.
  test('2xx면 본문을 읽지 못해도 성공으로 처리한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('not json'); },
    } as unknown as Response)));
    const result = setup();

    let outcome!: Awaited<ReturnType<ReturnType<typeof useWithdrawAccount>>>;
    await act(async () => { outcome = await result.current(); });

    expect(outcome.ok).toBe(true);
    expect(localStorage.getItem(e2eeKeyName(USER_ID))).toBeNull();
    expect(signOut).toHaveBeenCalled();
  });

  // 이게 없으면 "저장되지 않은 변경" 프롬프트가 뜨고, 사용자가 "머무르기"를 누르면
  // 삭제된 계정 위에 살아 있는 쿠키로 남는다.
  test('signOut 직전에 beforeunload 가드를 내린다', async () => {
    vi.stubGlobal('fetch', respond(200, { success: true }));
    const onBeforeSignOut = vi.fn();
    const result = setup({ onBeforeSignOut });

    await act(async () => { await result.current(); });

    expect(onBeforeSignOut).toHaveBeenCalled();
    expect(onBeforeSignOut.mock.invocationCallOrder[0])
      .toBeLessThan(signOut.mock.invocationCallOrder[0]);
  });

  test('세션에 id가 없으면 요청조차 보내지 않는다', async () => {
    sessionState.data = { user: {} };
    const fetchMock = respond(200);
    vi.stubGlobal('fetch', fetchMock);
    const result = setup();

    let outcome!: Awaited<ReturnType<ReturnType<typeof useWithdrawAccount>>>;
    await act(async () => { outcome = await result.current(); });

    expect(outcome.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});

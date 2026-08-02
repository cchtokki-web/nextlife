import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { SimulationParams } from '@/core/entities/types';

// useSession은 훅 전체 분기의 입구다. 테스트마다 값을 갈아 끼운다.
const sessionState = { data: null as unknown, status: 'loading' as string };
vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
}));

// 암복호화는 WebCrypto가 필요해 jsdom에서 그대로 돌릴 수 없다. 그 둘만 대역으로 바꾸고
// 나머지는 실물을 쓴다 — 특히 형태 판정(isEncryptedPayload)은 규칙을 복제하면 안 된다.
// 복제본은 원본이 강화될 때(예: iterations 검증 추가) 조용히 어긋나고, 그러면 이 파일의
// needsKeyRestore 테스트 전체가 실제와 다른 분기를 통과시킨다.
const decryptData = vi.fn();
const encryptData = vi.fn();
vi.mock('@/core/utils/crypto', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/core/utils/crypto')>(),
  decryptData: (...args: unknown[]) => decryptData(...args),
  encryptData: (...args: unknown[]) => encryptData(...args),
}));

const loadParams = vi.fn();
const saveParams = vi.fn();
vi.mock('@/infrastructure/storage/localStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/infrastructure/storage/localStore')>();
  return {
    ...actual,
    loadParams: () => loadParams(),
    saveParams: (p: SimulationParams) => saveParams(p),
  };
});

import { useScenarios } from '@/web/features/Scenario/useScenarios';
import { initialParams } from '@/infrastructure/storage/localStore';

const USER_ID = 'user-1';
const KEY_NAME = `nextlife_e2ee_key_${USER_ID}`;

function signedIn() {
  sessionState.data = { user: { id: USER_ID, email: 'a@b.c' } };
  sessionState.status = 'authenticated';
}
function signedOut() {
  sessionState.data = null;
  sessionState.status = 'unauthenticated';
}

const encrypted = { isEncrypted: true, ciphertext: 'x', iv: 'y' };

// fetch 대역. 경로별로 응답을 지정하고, 지정하지 않은 경로는 빈 성공으로 답한다.
function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const body = routes[key] ?? routes[url] ?? { success: true };
    return { ok: true, json: async () => body } as unknown as Response;
  });
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  loadParams.mockReturnValue(null);
  saveParams.mockReset();
  decryptData.mockReset();
  encryptData.mockReset();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', mockFetch({}));
});

afterEach(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  vi.unstubAllGlobals();
});

describe('useScenarios — 비로그인', () => {
  test('로컬 기본 시나리오를 만들고 로딩을 끝낸다', async () => {
    signedOut();
    const { result } = renderHook(() => useScenarios());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.scenarios).toHaveLength(1);
    expect(result.current.activeScenarioId).toBe('local-default');
    expect(result.current.scenarios[0].isDefault).toBe(true);
  });

  test('저장된 params가 있으면 그것으로 시작한다', async () => {
    signedOut();
    const saved: SimulationParams = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 41 },
    };
    loadParams.mockReturnValue(saved);

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.activeParams.userProfile.currentAge).toBe(41);
  });

  test('값을 바꾸면 로컬 저장소에 즉시 저장한다', async () => {
    signedOut();
    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    saveParams.mockClear();

    act(() => {
      result.current.handleUpdateActiveParams((prev) => ({
        ...prev,
        userProfile: { ...prev.userProfile, currentAge: 52 },
      }));
    });

    await waitFor(() => expect(saveParams).toHaveBeenCalled());
    expect(result.current.saveStatus).toBe('success');
    expect(result.current.activeParams.userProfile.currentAge).toBe(52);
  });

  test('같은 값을 다시 넣으면 저장하지 않는다', async () => {
    signedOut();
    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    saveParams.mockClear();

    act(() => {
      result.current.handleUpdateActiveParams((prev) => ({ ...prev }));
    });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(saveParams).not.toHaveBeenCalled();
  });
});

describe('useScenarios — 로그인', () => {
  test('평문으로 저장된 시나리오를 그대로 읽는다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: '내 시나리오', isDefault: true, data: initialParams }],
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.scenarios).toHaveLength(1);
    expect(result.current.activeScenarioId).toBe('s1');
    expect(result.current.needsKeyRestore).toBe(false);
  });

  test('암호화된 시나리오를 키로 복호화해 읽는다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    const secret: SimulationParams = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 47 },
    };
    decryptData.mockResolvedValue(secret);
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: 'x', isDefault: true, data: encrypted }],
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.activeParams.userProfile.currentAge).toBe(47);
    expect(result.current.needsKeyRestore).toBe(false);
  });

  // 키가 없는데 서버에 암호화된 데이터가 있으면 복호화할 수 없다. 이때 기본값으로 덮어
  // 저장해 버리면 사용자의 실제 데이터가 영구히 사라진다 — needsKeyRestore가 그것을 막는다.
  test('키가 없으면 복구를 요구하고 기본값으로 덮어쓰지 않는다', async () => {
    signedIn();
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: 'x', isDefault: true, data: encrypted }],
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.needsKeyRestore).toBe(true));

    expect(result.current.isLoaded).toBe(true);
    // 자동저장이 막혀 서버로 PUT이 나가지 않아야 한다.
    await new Promise((r) => setTimeout(r, 50));
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false);
  });

  test('복호화에 실패해도 복구를 요구하고 로딩은 끝낸다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'WRONGKEY');
    decryptData.mockRejectedValue(new Error('bad key'));
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: 'x', isDefault: true, data: encrypted }],
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.needsKeyRestore).toBe(true);
  });

  // 처음 가입한 사용자다. 키를 자동 생성하지 않고 사용자가 직접 정하게 한다.
  test('시나리오도 키도 없으면 키 설정을 요구한다', async () => {
    signedIn();
    vi.stubGlobal('fetch', mockFetch({ '/api/scenarios': { data: [] } }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.needsKeySetup).toBe(true);
  });

  test('서버 응답이 실패하면 오류를 노출하고 로딩을 끝낸다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)));

    const { result } = renderHook(() => useScenarios());

    // fetchWithRetry가 3회 재시도한다(1.5초 간격). 타이머를 실제로 기다리지 않도록
    // 최종 상태만 확인한다.
    await waitFor(() => expect(result.current.loadError).not.toBeNull(), { timeout: 8000 });
    expect(result.current.isLoaded).toBe(true);
  }, 15000);
});

describe('useScenarios — 로그인 사용자의 자동저장', () => {
  async function loadedHook() {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    encryptData.mockResolvedValue(encrypted);
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: 'x', isDefault: true, data: initialParams }],
      },
    }));
    const hook = renderHook(() => useScenarios());
    await waitFor(() => expect(hook.result.current.isLoaded).toBe(true));
    return hook;
  }

  const putCalls = () =>
    (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');

  test('편집 직후에는 저장 중 상태로 표시하고 디바운스 뒤에 보낸다', async () => {
    const { result } = await loadedHook();

    act(() => {
      result.current.handleUpdateActiveParams((prev) => ({
        ...prev,
        userProfile: { ...prev.userProfile, currentAge: 53 },
      }));
    });

    // 즉시 보내지 않는다 — 타이핑 중 매 글자마다 서버로 나가면 안 된다.
    await waitFor(() => expect(result.current.isSaving).toBe(true));
    expect(putCalls()).toHaveLength(0);

    await waitFor(() => expect(putCalls().length).toBeGreaterThan(0), { timeout: 4000 });
    await waitFor(() => expect(result.current.saveStatus).toBe('success'));
    expect(result.current.isSaving).toBe(false);
  }, 10000);

  test('서버에 보내는 payload는 암호화된 형태다', async () => {
    const { result } = await loadedHook();

    act(() => {
      result.current.handleUpdateActiveParams((prev) => ({
        ...prev,
        userProfile: { ...prev.userProfile, currentAge: 54 },
      }));
    });

    await waitFor(() => expect(putCalls().length).toBeGreaterThan(0), { timeout: 4000 });

    // 평문이 그대로 나가면 E2EE가 무의미해진다.
    expect(encryptData).toHaveBeenCalled();
    const [, init] = putCalls()[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.data).toEqual(encrypted);
  }, 10000);
});

// isLoaded/loadError는 상태가 아니라 "이번에 불러올 대상(loadRequestKey)"과 "어디까지
// 불러왔는가"의 비교로 얻는다. 요청 조건이 바뀌면 저절로 false가 되어야 한다.
describe('useScenarios — 재적재', () => {
  test('재시도를 요청하면 다시 불러오고 이전 오류가 남지 않는다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    let failing = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/scenarios' && failing) {
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      }
      if (url === '/api/scenarios') {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 's1', name: 'x', isDefault: true, data: initialParams }] }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.loadError).not.toBeNull(), { timeout: 8000 });

    failing = false;
    act(() => { result.current.handleRetryLoad(); });

    // 재시도 키가 바뀌는 순간 오류와 로딩 완료 표시가 함께 풀린다.
    await waitFor(() => expect(result.current.loadError).toBeNull());
    await waitFor(() => expect(result.current.isLoaded).toBe(true), { timeout: 8000 });
    expect(result.current.scenarios).toHaveLength(1);
  }, 20000);

  test('키를 복구하면 다시 불러온다', async () => {
    signedIn();
    decryptData.mockResolvedValue(initialParams);
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: 'x', isDefault: true, data: encrypted }],
      },
    }));

    const { result } = renderHook(() => useScenarios());
    // 키가 없어 복구가 필요한 상태로 시작한다.
    await waitFor(() => expect(result.current.needsKeyRestore).toBe(true));

    await act(async () => { await result.current.handleRestoreKey('ABC123'); });

    await waitFor(() => expect(result.current.needsKeyRestore).toBe(false));
    await waitFor(() => expect(result.current.isLoaded).toBe(true), { timeout: 8000 });
  }, 20000);
});

// 이 블록의 경로들은 실패하면 데이터가 영구히 사라진다.
describe('useScenarios — 데이터 유실 방어', () => {
  // 두 시나리오를 서로 다른 암호문으로 구분한다. 호출 순서(mockResolvedValueOnce)에 기대면
  // 복구 검증과 재적재가 각각 몇 번 복호화하는지에 따라 결과가 달라져 테스트가 깨진다.
  const good = { isEncrypted: true, ciphertext: 'GOOD', iv: 'y' };
  const corrupt = { isEncrypted: true, ciphertext: 'CORRUPT', iv: 'y' };

  async function loadedWithEncrypted(key: string | null) {
    signedIn();
    if (key) localStorage.setItem(KEY_NAME, key);
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [
          { id: 's1', name: 'a', isDefault: true, data: good },
          { id: 's2', name: 'b', isDefault: false, data: corrupt },
        ],
      },
    }));
    const hook = renderHook(() => useScenarios());
    await waitFor(() => expect(hook.result.current.isLoaded).toBe(true));
    return hook;
  }

  // 틀린 키를 받아들이면 자동저장이 그 키로 서버 데이터를 다시 암호화해 덮어쓴다.
  // 원래 키를 알아도 복구 불가능하다.
  test('어느 시나리오도 복호화하지 못하는 키는 거부하고 저장하지 않는다', async () => {
    decryptData.mockRejectedValue(new Error('bad key'));
    const { result } = await loadedWithEncrypted(null);
    await waitFor(() => expect(result.current.needsKeyRestore).toBe(true));

    let accepted: boolean | undefined;
    await act(async () => { accepted = await result.current.handleRestoreKey('WRONG1'); });

    expect(accepted).toBe(false);
    expect(localStorage.getItem(KEY_NAME)).toBeNull();
    expect(result.current.needsKeyRestore).toBe(true);
  });

  // 하나만 복호화돼도 키는 맞는 것이다. 이때 키를 다시 요구하면 무한 복구 루프가 된다.
  test('일부만 복호화되면 키를 받아들이고 손상 시나리오를 기억한다', async () => {
    decryptData.mockRejectedValue(new Error('corrupt'));
    const { result } = await loadedWithEncrypted(null);
    await waitFor(() => expect(result.current.needsKeyRestore).toBe(true));

    // s1은 언제나 복호화되고 s2는 언제나 실패한다 — 키는 맞고 s2 데이터만 손상된 상태.
    decryptData.mockReset();
    decryptData.mockImplementation(async (payload: { ciphertext: string }) => {
      if (payload.ciphertext === 'GOOD') return initialParams;
      throw new Error('corrupt');
    });

    let accepted: boolean | undefined;
    await act(async () => { accepted = await result.current.handleRestoreKey('RIGHT1'); });

    expect(accepted).toBe(true);
    expect(localStorage.getItem(KEY_NAME)).toBe('RIGHT1');
    await waitFor(() => expect(result.current.needsKeyRestore).toBe(false));
  });

  test('클라우드 저장이 실패하면 성공으로 표시하지 않는다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    encryptData.mockResolvedValue(encrypted);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      }
      if (url === '/api/scenarios') {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 's1', name: 'x', isDefault: true, data: initialParams }] }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => {
      result.current.handleUpdateActiveParams((prev) => ({
        ...prev,
        userProfile: { ...prev.userProfile, currentAge: 55 },
      }));
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('error'), { timeout: 5000 });
    // 저장 실패인데 lastSaved가 갱신되면 beforeunload 경고까지 사라진다.
    expect(result.current.lastSaved).toBeNull();
  }, 10000);

  // 숫자 6자리만 허용하면 10^6(약 20비트)로 시스템 생성 키보다 훨씬 약하다.
  test('약한 보안키는 거부한다', async () => {
    signedIn();
    vi.stubGlobal('fetch', mockFetch({ '/api/scenarios': { data: [] } }));
    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.needsKeySetup).toBe(true));

    for (const weak of ['', '12345', '1234567', 'AB!DEF']) {
      let accepted: boolean | undefined;
      await act(async () => { accepted = await result.current.handleSetupKey(weak); });
      expect(accepted, `"${weak}"가 통과했다`).toBe(false);
    }
    expect(localStorage.getItem(KEY_NAME)).toBeNull();
  }, 10000);
});

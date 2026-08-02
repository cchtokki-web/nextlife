import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { SimulationParams } from '@/core/entities/types';

// useSession은 훅 전체 분기의 입구다. 테스트마다 값을 갈아 끼운다.
const sessionState = { data: null as unknown, status: 'loading' as string };
vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
}));

// 암복호화는 WebCrypto가 필요해 jsdom에서 그대로 돌릴 수 없다. 형태 판정(isEncryptedPayload)은
// 실제 규칙을 그대로 쓰고, 암복호화만 대역으로 바꾼다 — 이 훅이 검증하려는 것은 분기이지
// 암호 알고리즘이 아니다.
const decryptData = vi.fn();
const encryptData = vi.fn();
vi.mock('@/core/utils/crypto', () => ({
  decryptData: (...args: unknown[]) => decryptData(...args),
  encryptData: (...args: unknown[]) => encryptData(...args),
  isEncryptedPayload: (data: unknown) =>
    !!data && typeof data === 'object'
    && (data as { isEncrypted?: boolean }).isEncrypted === true
    && typeof (data as { ciphertext?: string }).ciphertext === 'string'
    && typeof (data as { iv?: string }).iv === 'string',
  generateBackupKey: () => 'ABCDEF',
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

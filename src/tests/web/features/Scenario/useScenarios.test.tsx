import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { SimulationParams } from '@/core/entities/types';

// useSession은 훅 전체 분기의 입구다. 테스트마다 값을 갈아 끼운다.
const sessionState = { data: null as unknown, status: 'loading' as string };
const signOut = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
  signOut: (...args: unknown[]) => signOut(...args),
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
import { isEncryptedPayload } from '@/core/utils/crypto';
import { activeScenarioKeyName } from '@/infrastructure/storage/storageKeys';

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

type FetchCall = [string, RequestInit | undefined];
const fetchCalls = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as FetchCall[];
const sendKeyCalls = () => fetchCalls().filter(([url]) => url === '/api/user/send-backup-key');
const scenarioPostCalls = () =>
  fetchCalls().filter(([url, init]) => url === '/api/scenarios' && init?.method === 'POST');

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  loadParams.mockReturnValue(null);
  saveParams.mockReset();
  decryptData.mockReset();
  encryptData.mockReset();
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
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
  test('마지막으로 선택한 시나리오를 다시 접속했을 때 복원한다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    localStorage.setItem(activeScenarioKeyName(USER_ID), 's2');
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [
          { id: 's1', name: '기본', isDefault: true, data: initialParams },
          { id: 's2', name: '마지막 선택', isDefault: false, data: initialParams },
        ],
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.activeScenarioId).toBe('s2');
    expect(result.current.activeParams).toBe(result.current.scenarios[1].data);
  });

  test('선택한 시나리오를 계정별 브라우저 저장소에 기록한다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [
          { id: 's1', name: '기본', isDefault: true, data: initialParams },
          { id: 's2', name: '다른 계획', isDefault: false, data: initialParams },
        ],
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => result.current.setActiveScenarioId('s2'));

    expect(result.current.activeScenarioId).toBe('s2');
    expect(localStorage.getItem(activeScenarioKeyName(USER_ID))).toBe('s2');
  });

  test('저장된 시나리오가 삭제됐으면 첫 시나리오로 복구하고 낡은 값을 교체한다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    localStorage.setItem(activeScenarioKeyName(USER_ID), 'deleted');
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: '기본', isDefault: true, data: initialParams }],
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.activeScenarioId).toBe('s1');
    expect(localStorage.getItem(activeScenarioKeyName(USER_ID))).toBe('s1');
  });

  // 평문 행은 읽을 수 있지만 그대로 두면 안 된다. 서버에 평문이 하나라도 남아 있는 동안은
  // 그 계정이 키 없이 열리기 때문이다. 다음 편집을 기다리지 않고 지금 암호화해 되돌린다.
  test('평문으로 저장된 시나리오를 읽고 즉시 암호화해 되돌린다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    encryptData.mockResolvedValue(encrypted);
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

    const reencrypt = await waitFor(() => {
      const call = fetchCalls().find(([url, init]) => url === '/api/scenarios/s1' && init?.method === 'PUT');
      expect(call).toBeDefined();
      return call!;
    });
    expect(JSON.parse(reencrypt[1]!.body as string).data).toEqual(encrypted);
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

  // 이 계정이 잠겨 있다는 사실은 서버가 기억한다(e2eeEnabled). payload가 평문이라는 이유로
  // 키 요구가 사라지면, 평문 행이 하나 생긴 계정은 시크릿 창에서도 그냥 열린다 — E2EE가
  // 조용히 꺼진 채로 로그인만 하면 자산 데이터가 보인다.
  test('서버가 잠긴 계정이라 하면 평문이 와도 키를 요구하고 내용을 감춘다', async () => {
    signedIn();
    const exposed: SimulationParams = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 47 },
    };
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: 'x', isDefault: true, data: exposed }],
        e2eeEnabled: true,
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.needsKeyRestore).toBe(true);
    expect(result.current.activeParams.userProfile.currentAge)
      .toBe(initialParams.userProfile.currentAge);
  });

  // E2EE 도입 이전에 만들어진 계정이다. 평문 데이터가 있다는 이유로 발급을 건너뛰면 이 계정은
  // 영영 키를 못 받고, 평문인 채로 남는다.
  //
  // 이 테스트는 발급까지만 본다. 실제 재암호화는 사용자가 '확인'을 눌러 이펙트가 다시 돈
  // 뒤다 — 위 '평문으로 저장된 시나리오를 읽고 즉시 암호화해 되돌린다'가 그쪽을 덮는다.
  test('키를 받은 적 없는 계정은 평문 데이터가 있어도 보안키를 발급한다', async () => {
    signedIn();
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: 'x', isDefault: true, data: initialParams }],
        e2eeEnabled: false,
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.keyNotice).not.toBeNull());

    expect(sendKeyCalls()).toHaveLength(1);
    expect(localStorage.getItem(KEY_NAME)).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(result.current.needsKeyRestore).toBe(false);
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

  // 처음 가입한 사용자다. 사용자가 키를 고르게 두면 111111 같은 키가 들어오므로 시스템이 발급한다.
  test('키를 받은 적 없는 신규 가입자에게 보안키를 발급해 이메일로 보낸다', async () => {
    signedIn();
    vi.stubGlobal('fetch', mockFetch({ '/api/scenarios': { data: [] } }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.keyNotice?.status).toBe('sent'));

    const issuedKey = result.current.keyNotice!.key;
    // 생성기의 문자셋(모호한 0/O/1/I 제외)을 벗어나면 엔트로피 전제가 깨진 것이다.
    expect(issuedKey).toMatch(/^[23456789A-HJ-NP-Z]{6}$/);
    expect(localStorage.getItem(KEY_NAME)).toBe(issuedKey);
    // 아직 확인 전이므로 백업이 확인되지 않은 상태여야 한다.
    expect(localStorage.getItem(`nextlife_e2ee_backed_up_${USER_ID}`)).toBe('false');

    const sendCalls = sendKeyCalls();
    expect(sendCalls).toHaveLength(1);
    expect(JSON.parse(sendCalls[0][1]!.body as string).key).toBe(issuedKey);

    // 확인을 누르기 전에는 기본 시나리오를 만들지 않는다.
    expect(scenarioPostCalls()).toHaveLength(0);
  }, 10000);

  test('발급된 키를 확인하면 기본 시나리오를 만들고 진입시킨다', async () => {
    signedIn();
    encryptData.mockResolvedValue(encrypted);
    decryptData.mockResolvedValue(initialParams);
    vi.stubGlobal('fetch', mockFetch({ '/api/scenarios': { data: [] } }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.keyNotice?.status).toBe('sent'));
    const issuedKey = result.current.keyNotice!.key;

    await act(async () => { result.current.handleAcknowledgeKey(); });

    await waitFor(() => expect(result.current.keyNotice).toBeNull());
    expect(result.current.localKey).toBe(issuedKey);
    expect(localStorage.getItem(`nextlife_e2ee_backed_up_${USER_ID}`)).toBe('true');
    await waitFor(() => expect(scenarioPostCalls().length).toBeGreaterThan(0), { timeout: 8000 });
  }, 15000);

  test('이메일 전송이 실패하면 같은 키로 재시도할 수 있다', async () => {
    signedIn();
    let sendShouldFail = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/user/send-backup-key') {
        return sendShouldFail
          ? { ok: false, status: 429, json: async () => ({ error: '너무 많은 요청입니다.' }) } as unknown as Response
          : { ok: true, json: async () => ({ success: true }) } as unknown as Response;
      }
      if (url === '/api/scenarios') {
        return { ok: true, json: async () => ({ data: [] }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.keyNotice?.status).toBe('failed'));
    const issuedKey = result.current.keyNotice!.key;
    // 사용자가 무엇을 기다려야 하는지 알 수 있도록 서버 사유를 그대로 전달한다.
    expect(result.current.keyNotice).toMatchObject({ error: '너무 많은 요청입니다.' });

    sendShouldFail = false;
    await act(async () => { await result.current.handleRetrySendKey(); });

    await waitFor(() => expect(result.current.keyNotice?.status).toBe('sent'));
    // 새 키를 만들면 이미 발송된 키로 암호화된 데이터를 열 수 없게 된다.
    expect(result.current.keyNotice!.key).toBe(issuedKey);
    expect(localStorage.getItem(KEY_NAME)).toBe(issuedKey);
  }, 10000);

  // 외부 API 응답 본문이나 예외 메시지가 모달에 뜨면 사용자에게는 읽을 수 없는 잡음이고,
  // 우리에게는 내부 사정의 노출이다.
  test('사용자용이 아닌 서버 오류 문구는 모달에 전달하지 않는다', async () => {
    signedIn();
    const rawError = 'SMTP failed: {"responseCode":550}';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/user/send-backup-key') {
        return { ok: false, status: 400, json: async () => ({ error: rawError }) } as unknown as Response;
      }
      if (url === '/api/scenarios') {
        return { ok: true, json: async () => ({ data: [] }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.keyNotice?.status).toBe('failed'));
    expect(result.current.keyNotice).toMatchObject({ error: '이메일 전송에 실패했습니다.' });
  }, 10000);

  test('사용자용 이메일 오류 문구는 그대로 전달한다', async () => {
    signedIn();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/user/send-backup-key') {
        return {
          ok: false,
          status: 500,
          json: async () => ({
            error: '이메일로 보안키를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.',
          }),
        } as unknown as Response;
      }
      if (url === '/api/scenarios') {
        return { ok: true, json: async () => ({ data: [] }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    }));

    const { result } = renderHook(() => useScenarios());

    await waitFor(() => expect(result.current.keyNotice?.status).toBe('failed'));
    expect(result.current.keyNotice).toMatchObject({
      error: '이메일로 보안키를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }, 10000);

  // 이펙트가 다시 돌 때마다 발급하면 이메일에 서로 다른 키가 여러 개 도착한다.
  test('재렌더가 반복돼도 보안키는 한 번만 발급한다', async () => {
    signedIn();
    vi.stubGlobal('fetch', mockFetch({ '/api/scenarios': { data: [] } }));

    const { result, rerender } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.keyNotice?.status).toBe('sent'));

    rerender();
    rerender();
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(sendKeyCalls()).toHaveLength(1);
  }, 10000);

  // 발급 도중 창을 닫은 사용자. 키는 localStorage에 있지만 백업이 확인되지 않았다.
  test('백업이 확인되지 않은 키가 있으면 다시 안내한다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    localStorage.setItem(`nextlife_e2ee_backed_up_${USER_ID}`, 'false');
    decryptData.mockResolvedValue(initialParams);
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': { data: [{ id: 's1', name: 'x', isDefault: true, data: encrypted }] },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.keyNotice?.status).toBe('unbacked'));
    expect(result.current.keyNotice!.key).toBe('KEY123');
    // 재발급이 아니라 이미 가진 키를 다시 안내하는 것이므로 새 발송이 나가면 안 된다.
    expect(sendKeyCalls()).toHaveLength(0);

    await act(async () => { result.current.handleAcknowledgeKey(); });
    await waitFor(() => expect(result.current.keyNotice).toBeNull());
    expect(localStorage.getItem(`nextlife_e2ee_backed_up_${USER_ID}`)).toBe('true');
  }, 10000);

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
    // 이미 암호화된 상태로 시작한다. 평문으로 두면 로드 직후의 재암호화 PUT이 섞여
    // "디바운스 전에는 PUT이 없다"를 검증할 수 없다.
    decryptData.mockResolvedValue(initialParams);
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: 'x', isDefault: true, data: encrypted }],
        e2eeEnabled: true,
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

  // 저장 경로별 가드를 하나씩 검증하면 "지금 도달 가능한 경로"만 잡힌다. 여기서는 결과를 본다
  // — 로드/편집/가져오기/생성을 모두 거친 뒤, 서버로 나간 모든 쓰기의 data가 예외 없이 암호문
  // 형태여야 한다. isEncryptedPayload는 실물이므로(위 vi.mock 참조) 판정을 복제하지 않는다.
  test('서버로 나간 모든 쓰기는 예외 없이 암호문이다', async () => {
    const { result } = await loadedHook();

    act(() => {
      result.current.handleUpdateActiveParams((prev) => ({
        ...prev,
        userProfile: { ...prev.userProfile, currentAge: 56 },
      }));
    });
    await waitFor(() => expect(putCalls().length).toBeGreaterThan(0), { timeout: 4000 });

    await act(async () => {
      await result.current.handleUpdateScenarioData('s1', {
        ...initialParams,
        userProfile: { ...initialParams.userProfile, currentAge: 57 },
      });
    });
    await act(async () => {
      await result.current.handleCreateScenario('추가', initialParams);
    });

    const writes = fetchCalls().filter(([, init]) => init?.method === 'PUT' || init?.method === 'POST');
    expect(writes.length).toBeGreaterThan(2);
    for (const [url, init] of writes) {
      const body = JSON.parse(init!.body as string);
      if (body.data === undefined) continue;
      expect(isEncryptedPayload(body.data), `${init!.method} ${url} sent plaintext`).toBe(true);
    }
  }, 15000);

  // isSaving과 saveStatus가 따로 놀던 시절, 디바운스 안에 값을 되돌리면 이펙트 cleanup이
  // 타이머를 지워 finally가 영영 안 돌았다. Header는 isSaving을 먼저 보므로 저장이 멈춘
  // 화면에 "저장 중..."이 남았다.
  test('디바운스 안에 값을 되돌리면 저장 중 표시가 굳지 않는다', async () => {
    const { result } = await loadedHook();
    const original = result.current.activeParams.userProfile.currentAge;

    act(() => {
      result.current.handleUpdateActiveParams((prev) => ({
        ...prev,
        userProfile: { ...prev.userProfile, currentAge: 58 },
      }));
    });
    await waitFor(() => expect(result.current.isSaving).toBe(true));

    act(() => {
      result.current.handleUpdateActiveParams((prev) => ({
        ...prev,
        userProfile: { ...prev.userProfile, currentAge: original },
      }));
    });

    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(putCalls()).toHaveLength(0);
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
  test('401은 재시도하지 않고 세션을 정리한 뒤 로그인 화면으로 보낸다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/scenarios') {
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    }));

    const { result } = renderHook(() => useScenarios());

    await waitFor(() => expect(signOut).toHaveBeenCalledWith({
      callbackUrl: '/login?callbackUrl=/simulator',
    }));
    expect(fetchCalls().filter(([url]) => url === '/api/scenarios')).toHaveLength(1);
    expect(result.current.loadError).toBeNull();
  });

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

  // 키 없는 저장 한 번이 계정의 E2EE를 영구히 끈다. 서버에 평문이 남는 순간부터 그 계정은
  // 어느 브라우저에서든 키 없이 열리기 때문이다. 저장을 포기하는 쪽이 낫다.
  //
  // 저장 경로 셋 중 가져오기만 여기서 직접 본다. 자동저장과 생성은 needsKeyRestore 게이트와
  // 발급 모달이 먼저 막아 이 상태에 도달하지 않는다 — 세 경로를 결과로 함께 덮는 것은
  // 위 '서버로 나간 모든 쓰기는 예외 없이 암호문이다'다.
  test('키가 없으면 가져오기 저장을 서버로 보내지 않는다', async () => {
    signedIn();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: 'x', isDefault: true, data: encrypted }],
        e2eeEnabled: true,
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.needsKeyRestore).toBe(true));

    await act(async () => {
      await result.current.handleUpdateScenarioData('s1', {
        ...initialParams,
        userProfile: { ...initialParams.userProfile, currentAge: 61 },
      });
    });

    expect(fetchCalls().some(([, init]) => init?.method === 'PUT')).toBe(false);
    expect(result.current.saveStatus).toBe('error');
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  // 이 키로 암호문이 하나도 열리지 않았다면 그 키는 틀린 키다. 틀린 키로 평문 행을 암호화하면
  // 멀쩡히 읽히던 데이터가 아무도 못 여는 blob이 된다 — 사용자가 곧 맞는 키를 넣어도 늦다.
  test('키로 암호문이 하나도 안 열리면 평문 행을 재암호화하지 않는다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'WRONGK');
    decryptData.mockRejectedValue(new Error('bad key'));
    encryptData.mockResolvedValue(encrypted);
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [
          { id: 's1', name: 'a', isDefault: true, data: encrypted },
          { id: 's2', name: 'b', isDefault: false, data: initialParams },
        ],
        e2eeEnabled: true,
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.needsKeyRestore).toBe(true));

    await new Promise((r) => setTimeout(r, 100));
    expect(fetchCalls().some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  // 실패한 재암호화를 "저장됨"으로 남겨 두면 자동저장이 동일성 비교에서 영원히 건너뛴다.
  // 그러면 재암호화를 서두른 이유(다음 편집은 며칠 뒤일 수 있다)가 통째로 사라진다.
  test('재암호화가 실패하면 저장됨으로 기록하지 않고 오류를 표시한다', async () => {
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
    await waitFor(() => expect(result.current.saveStatus).toBe('error'), { timeout: 5000 });
  }, 10000);

  // res.ok를 안 보면 500에도 "저장됨" 기록이 남는다. 그러면 자동저장은 건너뛰고 beforeunload
  // 경고도 뜨지 않아, 사용자는 가져온 시나리오가 사라진 것을 다음 접속에야 안다.
  test('가져오기 저장이 실패하면 저장됨으로 기록하지 않는다', async () => {
    signedIn();
    localStorage.setItem(KEY_NAME, 'KEY123');
    encryptData.mockResolvedValue(encrypted);
    decryptData.mockResolvedValue(initialParams);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      }
      if (url === '/api/scenarios') {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 's1', name: 'x', isDefault: true, data: encrypted }],
            e2eeEnabled: true,
          }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const imported: SimulationParams = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 62 },
    };
    await act(async () => { await result.current.handleUpdateScenarioData('s1', imported); });

    // 저장됨으로 기록하지 않았으므로 자동저장이 같은 데이터를 다시 시도하고, 그것도 500이라
    // 최종 상태는 오류다. 기록해 버렸다면 자동저장은 아예 돌지 않고 조용히 끝났을 것이다.
    await waitFor(() => expect(result.current.saveStatus).toBe('error'), { timeout: 5000 });
    expect(alertSpy).toHaveBeenCalled();
    // 저장되지 않았으므로 beforeunload가 아직 경고할 수 있어야 한다.
    expect(result.current.lastSaved).toBeNull();
    alertSpy.mockRestore();
  }, 10000);

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

  // 검증할 암호문이 없으면 이 키가 맞는지 확인할 방법이 없다. 예전에는 검증 블록을 통째로
  // 건너뛰고 아무 6자리 문자열이나 정답으로 저장했다 — 그 키로 이후 데이터가 암호화되면
  // 사용자는 자기 데이터를 영원히 열 수 없다.
  test('서버에 암호문이 없으면 어떤 키도 받아들이지 않는다', async () => {
    decryptData.mockRejectedValue(new Error('bad key'));
    const { result } = await loadedWithEncrypted(null);
    await waitFor(() => expect(result.current.needsKeyRestore).toBe(true));

    // 복구를 시도하는 사이 서버 데이터가 사라졌다.
    vi.stubGlobal('fetch', mockFetch({ '/api/scenarios': { data: [] } }));

    let accepted: boolean | undefined;
    await act(async () => { accepted = await result.current.handleRestoreKey('ANY123'); });

    expect(accepted).toBe(false);
    expect(localStorage.getItem(KEY_NAME)).toBeNull();
    expect(result.current.restoreError).toBeTruthy();
  });

  // 잠겼다는데 대조할 암호문이 없으면 맞는 키도 검증할 수 없다. 그 사실을 모달에 알리지 않으면
  // 사용자는 맞는 키를 세 번 넣어 "틀렸다"는 거짓말을 세 번 듣고서야 탈출구를 본다.
  test('잠긴 계정에 암호문이 없으면 검증 불가 상태를 알린다', async () => {
    signedIn();
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: 'x', isDefault: true, data: initialParams }],
        e2eeEnabled: true,
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.needsKeyRestore).toBe(true));

    expect(result.current.restoreUnverifiable).toBe(true);
  });

  // 그 상태의 탈출구가 곧 데이터 파괴이면 안 된다. 이 경로에 온 이유가 "읽히는 평문뿐이라
  // 키를 검증할 수 없다"인데, 예전에는 그 평문을 initialParams로 덮어 버렸다.
  test('초기화는 읽히는 평문 시나리오를 새 키로 살린다', async () => {
    signedIn();
    const mine: SimulationParams = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 49 },
    };
    encryptData.mockResolvedValue(encrypted);
    decryptData.mockResolvedValue(mine);
    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': {
        data: [{ id: 's1', name: 'x', isDefault: true, data: mine }],
        e2eeEnabled: true,
      },
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.restoreUnverifiable).toBe(true));
    encryptData.mockClear();

    await act(async () => { await result.current.handleResetAndReissueKey(); });

    // 지우지 않고, 사용자의 실제 값을 새 키로 암호화해 되돌려 놓는다.
    expect(fetchCalls().some(([, init]) => init?.method === 'DELETE')).toBe(false);
    const newKey = localStorage.getItem(KEY_NAME);
    expect(encryptData).toHaveBeenCalledWith(mine, newKey, USER_ID);
  }, 10000);

  test('평문 시나리오만 있으면 어떤 키도 받아들이지 않는다', async () => {
    decryptData.mockRejectedValue(new Error('bad key'));
    const { result } = await loadedWithEncrypted(null);
    await waitFor(() => expect(result.current.needsKeyRestore).toBe(true));

    vi.stubGlobal('fetch', mockFetch({
      '/api/scenarios': { data: [{ id: 's1', name: 'x', isDefault: true, data: initialParams }] },
    }));

    let accepted: boolean | undefined;
    await act(async () => { accepted = await result.current.handleRestoreKey('ANY123'); });

    expect(accepted).toBe(false);
    expect(localStorage.getItem(KEY_NAME)).toBeNull();
  });

  // 보안키를 잊은 사용자의 마지막 탈출구. 여기서 실패하면 사용자는 계정에 영원히 갇힌다.
  test('초기화하면 시나리오를 지우고 새 키를 발급해 진입시킨다', async () => {
    // 옛 키로는 아무것도 열리지 않지만(good/corrupt), 초기화가 새로 써 넣은 암호문은 열린다.
    decryptData.mockImplementation(async (payload: { ciphertext: string }) => {
      if (payload.ciphertext === 'x') return initialParams;
      throw new Error('bad key');
    });
    encryptData.mockResolvedValue(encrypted);

    // 서버 상태를 실제로 반영하는 대역. 초기화가 지우고 다시 쓴 결과를 그대로 되돌려 줘야
    // "초기화 후 재적재까지 이어지는지"를 검증할 수 있다.
    signedIn();
    let serverScenarios: Array<{ id: string; name: string; isDefault: boolean; data: unknown }> = [
      { id: 's1', name: 'a', isDefault: true, data: good },
      { id: 's2', name: 'b', isDefault: false, data: corrupt },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/scenarios' && (init?.method ?? 'GET') === 'GET') {
        return { ok: true, json: async () => ({ data: serverScenarios }) } as unknown as Response;
      }
      if (init?.method === 'DELETE') {
        const id = url.split('/').pop();
        serverScenarios = serverScenarios.filter(s => s.id !== id);
        return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
      }
      if (init?.method === 'PUT') {
        const id = url.split('/').pop();
        const body = JSON.parse(init.body as string);
        serverScenarios = serverScenarios.map(s => s.id === id ? { ...s, data: body.data } : s);
        return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    }));

    const { result } = renderHook(() => useScenarios());
    await waitFor(() => expect(result.current.needsKeyRestore).toBe(true));

    await act(async () => { await result.current.handleResetAndReissueKey(); });

    // 기본 시나리오(s1)만 남기고 나머지는 지운다.
    const deleteCalls = fetchCalls().filter(([, init]) => init?.method === 'DELETE');
    expect(deleteCalls.map(([url]) => url)).toEqual(['/api/scenarios/s2']);
    // 남긴 기본 시나리오는 새 키로 다시 암호화한다.
    const putCall = fetchCalls().find(([url, init]) => url === '/api/scenarios/s1' && init?.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(JSON.parse(putCall![1]!.body as string).data).toEqual(encrypted);

    const newKey = localStorage.getItem(KEY_NAME);
    expect(newKey).toMatch(/^[23456789A-HJ-NP-Z]{6}$/);
    expect(result.current.keyNotice).toMatchObject({ status: 'sent', key: newKey });
    expect(sendKeyCalls()).toHaveLength(1);
    // 재적재까지 이어져야 한다. 전체 리로드 없이 복구 모달이 닫히는지가 핵심이다.
    await waitFor(() => expect(result.current.needsKeyRestore).toBe(false));
    await waitFor(() => expect(result.current.isLoaded).toBe(true), { timeout: 8000 });
  }, 15000);
});

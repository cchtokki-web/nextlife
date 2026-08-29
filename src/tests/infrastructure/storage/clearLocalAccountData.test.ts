import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearLocalAccountData } from '@/infrastructure/storage/clearLocalAccountData';
import {
  SIMPLE_SIMULATOR_INPUT_KEY,
  SIMPLE_SIMULATOR_HAS_RUN_KEY,
  THEME_KEY,
  ANALYTICS_SESSION_KEY,
  e2eeKeyName,
  e2eeBackedUpKeyName,
  activeScenarioKeyName,
  LOCAL_ANALYZED_AT_KEY,
  LOCAL_ANALYZED_PARAMS_HASH_KEY,
} from '@/infrastructure/storage/storageKeys';
import { loadParams, saveParams, initialParams } from '@/infrastructure/storage/localStore';

const USER = 'user-1';
const OTHER = 'user-2';

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  vi.restoreAllMocks();
});

describe('clearLocalAccountData', () => {
  // 보안키는 사용자별로 네임스페이스된다. 접두사로 쓸어 담으면 같은 브라우저를 쓰는
  // 다른 계정의 키까지 가져가고, 그 계정은 자기 데이터를 영영 열지 못한다.
  test('그 사용자의 계정별 브라우저 데이터만 지우고 다른 사용자의 것은 남긴다', () => {
    localStorage.setItem(e2eeKeyName(USER), 'AAA111');
    localStorage.setItem(e2eeBackedUpKeyName(USER), 'true');
    localStorage.setItem(activeScenarioKeyName(USER), 'scenario-2');
    localStorage.setItem(e2eeKeyName(OTHER), 'BBB222');
    localStorage.setItem(e2eeBackedUpKeyName(OTHER), 'true');
    localStorage.setItem(activeScenarioKeyName(OTHER), 'scenario-8');

    clearLocalAccountData(USER);

    expect(localStorage.getItem(e2eeKeyName(USER))).toBeNull();
    expect(localStorage.getItem(e2eeBackedUpKeyName(USER))).toBeNull();
    expect(localStorage.getItem(activeScenarioKeyName(USER))).toBeNull();
    expect(localStorage.getItem(e2eeKeyName(OTHER))).toBe('BBB222');
    expect(localStorage.getItem(e2eeBackedUpKeyName(OTHER))).toBe('true');
    expect(localStorage.getItem(activeScenarioKeyName(OTHER))).toBe('scenario-8');
  });

  // 탈퇴가 화면 색을 바꾸거나 익명 분석 식별자를 리셋할 이유는 없다.
  // localStorage.clear()나 접두사 일괄 삭제로 바뀌면 여기서 걸린다.
  test('테마와 익명 세션 식별자는 남긴다', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    sessionStorage.setItem(ANALYTICS_SESSION_KEY, 'sess-abc');

    clearLocalAccountData(USER);

    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(sessionStorage.getItem(ANALYTICS_SESSION_KEY)).toBe('sess-abc');
  });

  // 리터럴이 아니라 실제 writer(saveParams)를 거친다. 키 이름이 바뀌면 이 테스트가 깨져
  // 정리 목록이 조용히 낡는 것을 막는다.
  test('saveParams로 저장한 시뮬레이터 입력을 지운다', () => {
    saveParams({
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 41 },
    });
    expect(loadParams()?.userProfile.currentAge).toBe(41);

    clearLocalAccountData(USER);

    // loadParams는 저장된 값이 없으면 기본값으로 폴백한다. 41이 사라졌다는 것이 곧
    // 저장소에서 지워졌다는 뜻이다.
    expect(loadParams()?.userProfile.currentAge).toBe(initialParams.userProfile.currentAge);
  });

  test('랜딩 간이 시뮬레이터의 입력값도 지운다', () => {
    localStorage.setItem(SIMPLE_SIMULATOR_INPUT_KEY, '{"currentAge":45}');

    clearLocalAccountData(USER);

    expect(localStorage.getItem(SIMPLE_SIMULATOR_INPUT_KEY)).toBeNull();
  });

  // 입력값만 지우고 이 표시를 남기면, 탈퇴 후 비로그인 상태로 돌아온 브라우저가 기본값 위에
  // "분석했던 계획"을 복원한 것처럼 보인다.
  test('비로그인 세션의 분석 표시도 지운다', () => {
    localStorage.setItem(LOCAL_ANALYZED_AT_KEY, '2026-08-01T00:00:00.000Z');
    localStorage.setItem(LOCAL_ANALYZED_PARAMS_HASH_KEY, 'deadbeef');

    clearLocalAccountData(USER);

    expect(localStorage.getItem(LOCAL_ANALYZED_AT_KEY)).toBeNull();
    expect(localStorage.getItem(LOCAL_ANALYZED_PARAMS_HASH_KEY)).toBeNull();
  });

  // 나머지 키가 전부 localStorage라 가장 빠뜨리기 쉬운 항목이다.
  test('간이 시뮬레이터의 sessionStorage 실행 표시도 지운다', () => {
    sessionStorage.setItem(SIMPLE_SIMULATOR_HAS_RUN_KEY, 'true');

    clearLocalAccountData(USER);

    expect(sessionStorage.getItem(SIMPLE_SIMULATOR_HAS_RUN_KEY)).toBeNull();
  });

  // 하나의 try로 묶으면 첫 예외에서 나머지가 통째로 건너뛰어진다. 하필 그 나머지가
  // 보안키면 탈퇴한 계정의 복호화 키가 기기에 남는다 — 이 함수가 막으려던 상태 그대로다.
  test('한 키의 삭제가 예외를 던져도 나머지를 계속 지운다', () => {
    localStorage.setItem(e2eeKeyName(USER), 'AAA111');
    localStorage.setItem(e2eeBackedUpKeyName(USER), 'true');

    const real = Storage.prototype.removeItem;
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key: string
    ) {
      if (key === e2eeKeyName(USER)) throw new DOMException('quota', 'SecurityError');
      return real.call(this, key);
    });

    clearLocalAccountData(USER);

    // 던진 키 뒤에 오는 것들이 살아남아야 한다.
    expect(localStorage.getItem(e2eeBackedUpKeyName(USER))).toBeNull();
    expect(spy).toHaveBeenCalledWith(SIMPLE_SIMULATOR_HAS_RUN_KEY);
    expect(consoleError).toHaveBeenCalled();
  });
});

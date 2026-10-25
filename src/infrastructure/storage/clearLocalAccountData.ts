import {
  SIMULATOR_PARAMS_KEY,
  SIMPLE_SIMULATOR_INPUT_KEY,
  SIMPLE_SIMULATOR_HAS_RUN_KEY,
  LOCAL_ANALYZED_AT_KEY,
  LOCAL_ANALYZED_PARAMS_HASH_KEY,
  e2eeKeyName,
  e2eeBackedUpKeyName,
  activeScenarioKeyName,
} from './storageKeys';

/**
 * 탈퇴한 계정이 이 브라우저에 남긴 흔적을 지운다.
 *
 * userId를 받는 이유는 보안키가 사용자별로 네임스페이스되어 있기 때문이다. 그래서 이 함수는
 * signOut보다 반드시 먼저 불려야 한다 — 세션이 사라진 뒤에는 키 이름 자체를 만들 수 없다.
 *
 * `nextlife_` 접두사 일괄 삭제를 쓰지 않은 이유:
 *   - `nextlife_`는 앱의 네임스페이스지 계정의 네임스페이스가 아니다. 나중에
 *     nextlife_consent_analytics 같은 키가 생기면 "계정 데이터 삭제"라는 이름의 함수가
 *     동의 기록을 조용히 날린다. 그때 깨지는 테스트도 없다.
 *   - 한 브라우저에서 두 계정을 쓴 경우 nextlife_e2ee_ 접두사 삭제는 다른 계정의 보안키까지
 *     가져간다. userId로 정확히 조립하는 편이 맞다.
 *
 * theme과 analytics_session_id는 계정 데이터가 아니므로 남긴다(storageKeys.ts 참조).
 */
export function clearLocalAccountData(userId: string): void {
  if (typeof window === 'undefined') return;

  // 키마다 따로 감싼다. 하나의 try로 묶으면 첫 removeItem이 던지는 순간 나머지가 통째로
  // 건너뛰어지고, 하필 그 나머지에 보안키가 들어 있으면 탈퇴한 계정의 복호화 키가 기기에
  // 남는다 — 이 함수가 막으려던 바로 그 상태다.
  const remove = (store: Storage, key: string) => {
    try {
      store.removeItem(key);
    } catch (err) {
      console.error(`Failed to clear ${key} on withdrawal:`, err);
    }
  };

  for (const key of [
    e2eeKeyName(userId),
    e2eeBackedUpKeyName(userId),
    activeScenarioKeyName(userId),
    SIMULATOR_PARAMS_KEY,
    SIMPLE_SIMULATOR_INPUT_KEY,
    // SIMULATOR_PARAMS_KEY와 한 쌍이다. 입력값만 지우고 이 표시를 남기면, 탈퇴 후 비로그인
    // 상태로 돌아온 브라우저가 기본값 위에 "분석했던 계획"을 복원한 것처럼 보인다.
    LOCAL_ANALYZED_AT_KEY,
    LOCAL_ANALYZED_PARAMS_HASH_KEY,
  ]) {
    remove(localStorage, key);
  }

  remove(sessionStorage, SIMPLE_SIMULATOR_HAS_RUN_KEY);
}

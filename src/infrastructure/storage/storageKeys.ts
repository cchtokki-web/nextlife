// 브라우저 저장소 키의 단일 출처.
//
// 흩어진 리터럴을 모은 이유는 탈퇴다. "이 계정의 흔적을 지운다"를 구현하려면 무엇이 저장돼
// 있는지 한 곳에서 읽혀야 하는데, 예전에는 다섯 개 키가 네 파일에 리터럴로 흩어져 있어
// 목록을 만들려면 grep에 의존해야 했다. grep으로 만든 목록은 다음에 키가 하나 늘 때 조용히
// 낡는다.

/** 시뮬레이터 전체 입력값(SimulationParams). 사용자별 네임스페이스가 아니다. */
export const SIMULATOR_PARAMS_KEY = 'nextlife_simulator_params';

/** 랜딩 간이 시뮬레이터 입력값. */
export const SIMPLE_SIMULATOR_INPUT_KEY = 'nextlife_simple_simulator_input';

/** 랜딩 간이 시뮬레이터를 한 번이라도 돌렸는지 (sessionStorage). */
export const SIMPLE_SIMULATOR_HAS_RUN_KEY = 'nextlife_simple_simulator_has_run';

/**
 * 비로그인 세션의 기본 시나리오에서 「분석 시작」을 누른 시각(ISO).
 *
 * 로그인 계정에서는 같은 사실을 Scenario.analyzedAt이 들고 있다. 비로그인 세션에는 서버에
 * 대응하는 행이 없어 그 자리가 여기다 — 없으면 새로고침 한 번에 결과 화면이 사라진다.
 * 시나리오가 local-default 하나뿐이므로 SIMULATOR_PARAMS_KEY와 마찬가지로 사용자별
 * 네임스페이스가 아니다.
 */
export const LOCAL_ANALYZED_AT_KEY = 'nextlife_local_analyzed_at';

/**
 * 위 시각과 «짝»인 값. 분석 당시 입력의 해시이며, 로그인 계정의
 * Scenario.analyzedParamsHash가 하는 일을 비로그인 세션에서 대신한다.
 * 둘은 항상 함께 쓰이고 함께 지워진다(setScenarioAnalyzed, clearLocalAccountData).
 */
export const LOCAL_ANALYZED_PARAMS_HASH_KEY = 'nextlife_local_analyzed_params_hash';

/** E2EE 보안키. 사용자별로 다르므로 반드시 userId로 조립한다. */
export const e2eeKeyName = (userId: string) => `nextlife_e2ee_key_${userId}`;

/** 그 보안키를 사용자가 백업했다고 확인했는지. 역시 사용자별. */
export const e2eeBackedUpKeyName = (userId: string) => `nextlife_e2ee_backed_up_${userId}`;

/** 시뮬레이터에서 마지막으로 선택한 시나리오. 계정별로 복원한다. */
export const activeScenarioKeyName = (userId: string) => `nextlife_active_scenario_${userId}`;

// 아래 둘은 계정 데이터가 아니다. 탈퇴해도 남긴다.
//   theme — UI 취향. 지우면 탈퇴가 화면 색을 바꾸는 셈이 된다.
//   analytics_session_id — 계정과 무관한 익명 식별자.
// 여기 적어 두는 것은 지우기 위해서가 아니라, "왜 안 지우는지"를 한 곳에 남겨 두기 위해서다.
export const THEME_KEY = 'theme';
export const ANALYTICS_SESSION_KEY = 'analytics_session_id';

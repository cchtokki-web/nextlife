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

/** E2EE 보안키. 사용자별로 다르므로 반드시 userId로 조립한다. */
export const e2eeKeyName = (userId: string) => `nextlife_e2ee_key_${userId}`;

/** 그 보안키를 사용자가 백업했다고 확인했는지. 역시 사용자별. */
export const e2eeBackedUpKeyName = (userId: string) => `nextlife_e2ee_backed_up_${userId}`;

// 아래 둘은 계정 데이터가 아니다. 탈퇴해도 남긴다.
//   theme — UI 취향. 지우면 탈퇴가 화면 색을 바꾸는 셈이 된다.
//   analytics_session_id — 계정과 무관한 익명 식별자.
// 여기 적어 두는 것은 지우기 위해서가 아니라, "왜 안 지우는지"를 한 곳에 남겨 두기 위해서다.
export const THEME_KEY = 'theme';
export const ANALYTICS_SESSION_KEY = 'analytics_session_id';

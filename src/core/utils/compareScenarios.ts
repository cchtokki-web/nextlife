/**
 * 대시보드에서 함께 비교하는 시나리오 목록의 단일 출처.
 *
 * 이 값은 세 곳을 오간다 — 화면(useScenarios), 계정 저장(User.compareScenarioIds), 그리고
 * 그 둘을 잇는 두 라우트(GET /api/scenarios, PUT /api/user/active-scenario). 저장 형식이
 * JSON 문자열이라 파싱을 각자 하면 세 곳이 서로 다른 방식으로 망가진 값을 다루게 된다.
 */

/** 한 번에 비교할 수 있는 시나리오 수. 차트 범례와 색상이 이 수를 전제로 한다. */
export const MAX_COMPARE_SCENARIO_COUNT = 3;

/**
 * 계정에 저장된 JSON 문자열을 id 배열로 읽는다.
 *
 * 어떤 입력에도 던지지 않는다. 이 값이 깨져 있다는 이유로 시나리오 목록 전체가 500이 되면,
 * 사용자는 자기 데이터를 열지 못한 채 "비교 대상 하나"를 잃는 대가를 치른다. 읽을 수 없으면
 * 비교 대상이 없는 것으로 보고, 다음 토글이 성한 값을 덮어써 스스로 낫는다.
 */
export function parseCompareScenarioIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .slice(0, MAX_COMPARE_SCENARIO_COUNT);
  } catch {
    return [];
  }
}

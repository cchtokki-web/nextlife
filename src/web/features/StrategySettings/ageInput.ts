// 설정 화면의 나이 입력 파싱 규약. 두 섹션(기본 정보·경제 가정)이 공유한다.
//
// 값들 사이의 상호 관계(은퇴 나이 > 현재 나이 등)는 여기서 강제하지 않는다 —
// 타이핑 중간 상태(예: 85 → 8 → 82)를 되돌리면 입력이 튀기 때문이며, 설정 화면은
// 이미 그런 모순을 되돌리는 대신 경고로 알리는 정책을 쓴다.
//
// 하한이 1인 이유: 0은 사람 나이로 의미가 없을 뿐 아니라, currentAge 0이 저장되면
// SimulationEngine의 totalYears 가드(<= 0)를 통과해 0~90세 = 91년짜리 시뮬레이션이
// 조용히 돌아간다. 0세 기대수명·0세 은퇴도 마찬가지로 계산이 성립하지 않는다.
export const AGE_MIN = 1;
export const AGE_MAX = 120;
export const EXPECTANCY_MAX = 130;

// 나이 입력 파싱. 저장하지 말아야 할 입력이면 null을 돌려준다.
//
// 빈 문자열을 그냥 Number()에 넣으면 0이 된다. 나이 입력은 디바운스 자동저장(useScenarios)과
// 겹치므로, 사용자가 값을 지우고 다음 숫자를 치기 전에 저장이 걸리면 그 0이 암호화 저장소에
// 영구히 남는다. HTML의 min/max 속성은 이 경로를 전혀 막지 못하므로(빈 값은 검증 대상이
// 아니고, 타입 number 입력도 프로그램적으로는 무엇이든 넣을 수 있다) 모든 나이 입력이
// 반드시 이 함수를 거쳐야 한다 — 의료비의 장기요양 시작 나이·급증 발생 나이도 예외가 아니다.
export function parseAge(raw: string, max: number = AGE_MAX): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(AGE_MIN, value));
}

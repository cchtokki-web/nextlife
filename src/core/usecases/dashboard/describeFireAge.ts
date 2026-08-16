// FIRE 달성 나이(SimulationResult.fireAge)를 사람이 읽는 문구로 만든다.
//
// **retirementAge와의 비교가 필요한 이유**: fireAge는 "소득만으로 생활비를 감당하게 되는
// 시점"이지 "은퇴할 수 있는 시점"이 아니다. 60세 은퇴를 계획한 사용자에게 73이라는 숫자만
// 보여주면 이미 지나간 시점을 "조기은퇴 가능 나이"라고 말하는 형용모순이 된다. 그래서 은퇴
// 계획 대비 상대 위치를 함께 인쇄한다.
//
// 예전에는 여기에 "원금 인출이 소득에 포함되는 구조적 한계는 그대로 남는다"고 적혀 있었다.
// 문구로 완화하려던 것인데, 문구는 fireAge가 «늦게» 나올 때의 오해만 막는다. 실제 문제는
// 사적연금 인출이 소득에 섞여 실제보다 «이르게» 나오는 것이었고(잔액 10억을 넣으면 달성
// 나이가 65세 → 60세로 앞당겨졌다) 그건 문구로 막을 수 없었다. 이제 SimulationEngine의
// FIRE 판정이 사적연금 인출을 제외하므로 그 한계는 없다.
//
// 이 함수는 retirementAge 비교 문구의 단일 정의점이다. 다만 모든 인쇄 지점이 여기를 거치지는
// 않는다 — ai-advisor route는 userProfile이 없어 비교 기준을 못 만드는 경우 숫자만 직접 적는다.
export function describeFireAge(
  fireAge: number | null | undefined,
  retirementAge: number
): string {
  if (fireAge === null || fireAge === undefined) return '달성 불가능';

  if (fireAge <= retirementAge) {
    return `${fireAge}세 (은퇴 시점에 이미 달성)`;
  }

  const delayYears = fireAge - retirementAge;
  return `${fireAge}세 — 현재 은퇴 계획(${retirementAge}세)보다 ${delayYears}년 늦음`;
}

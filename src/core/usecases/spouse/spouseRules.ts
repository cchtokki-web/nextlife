import { SpendingFactor, SpouseProfile, UserProfile } from '../../entities/types';

// 2인 가구 → 1인 가구로 줄었을 때의 소비지출 비율.
// 통계청 가계동향조사의 1인 가구 대비 2인 가구 소비지출 비(대략 1.4~1.5배)를 역수로
// 단순화한 값이다. 주거·공과금처럼 인원이 줄어도 그대로인 고정비가 있어 0.5가 아니다.
export const SINGLE_SURVIVOR_SPENDING_FACTOR = 0.7;

// 유족연금 지급률. 실제 국민연금 유족연금은 가입기간에 따라 40~60%로 나뉘지만
// 이 앱은 가입기간 정보를 받지 않으므로 최대치인 60%로 단순화한다.
export const SURVIVOR_PENSION_INHERIT_RATE = 0.6;

export interface ResolvedSpouse {
  currentAge: number;
  expectancy: number;
  // 배우자가 사망하는 시점을 "본인 나이"로 환산한 값. 엔진 루프는 본인 나이로
  // 돌기 때문에, 매 연도 배우자 나이를 다시 계산하지 않아도 되도록 미리 넣어 둔다.
  deathAtSelfAge: number;
  // 시뮬레이션 시작 시점의 본인 나이. 본인 나이 → 배우자 나이 환산에 쓴다.
  selfStartAge: number;
}

// 입력값을 정규화한다. 잘못된 값(기대수명 < 현재 나이)은 던지지 않고 클램프한다 —
// UI가 이미 경고를 표시하고 있고, 여기서 던지면 타이핑 중간 상태에서 화면 전체가 죽는다.
export function resolveSpouse(
  spouse: SpouseProfile | undefined,
  userProfile: UserProfile
): ResolvedSpouse | null {
  if (!spouse || !spouse.enabled) return null;

  const currentAge = Math.max(0, spouse.currentAge);
  const expectancy = Math.max(currentAge, spouse.expectancy);

  return {
    currentAge,
    expectancy,
    deathAtSelfAge: userProfile.currentAge + (expectancy - currentAge),
    selfStartAge: userProfile.currentAge,
  };
}

// 시뮬레이션 종료 나이(본인 나이 기준). 둘 중 늦게 사망하는 쪽까지 돌린다.
export function computeHouseholdEndAge(
  userProfile: UserProfile,
  resolved: ResolvedSpouse | null
): number {
  if (!resolved) return userProfile.expectancy;
  return Math.max(userProfile.expectancy, resolved.deathAtSelfAge);
}

// 생존 인원에 따른 생활비 계수.
// 반환 타입이 SpendingFactor(0 | 0.7 | 1)라, SINGLE_SURVIVOR_SPENDING_FACTOR를 바꾸면
// 여기서 컴파일 에러가 나 결과 타입과 이 함수가 어긋나지 못한다.
export function computeSpendingFactor(selfAlive: boolean, spouseAlive: boolean): SpendingFactor {
  if (selfAlive && spouseAlive) return 1;
  if (!selfAlive && !spouseAlive) return 0;
  return SINGLE_SURVIVOR_SPENDING_FACTOR;
}

// 사망자의 국민연금을 생존자가 유족연금으로 이어받는 금액.
//
// 예전에는 `max(생존자 본인 연금, 사망자 연금 × 지급률)`이라는 중복조정 비교였다. 그 비교는
// 두 사람이 **각자** 연금을 가질 때만 의미가 있는데, 배우자 명의 국민연금을 다루지 않게
// 되면서 비교 대상이 사라졌다. 남는 규칙은 승계 하나뿐이다.
//
// 이 규칙 자체는 남겨야 한다. 배우자 명의 연금이 아니라 **본인** 연금이 이어지는 것이라,
// 함께 지우면 본인 사후 배우자 단독 생존 구간의 국민연금 소득이 통째로 0이 되어
// 고갈 나이·점수가 크게 뒤틀린다.
export function inheritSurvivorPension(deceasedMonthly: number): number {
  return deceasedMonthly * SURVIVOR_PENSION_INHERIT_RATE;
}

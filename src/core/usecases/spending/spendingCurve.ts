import { SpendingCurve, SpendingShapePreset } from '../../entities/types';

// 연령대별 생활비 곡선의 경계 나이 기본값.
//
// 60대/70대/80대라는 한국어 생활 구분과 맞고, 은퇴 나이(대개 60~65)가 첫 구간 안에 들어와
// "은퇴 직후 = 활동기"라는 직관과 어긋나지 않는다.
// Object.freeze인 이유: resolveSpendingCurve가 이 배열의 참조를 그대로 곡선에 실어 보낸다.
// readonly는 컴파일 타임 표시일 뿐이라, 소비처에서 단 한 번의 타입 단언으로 push하면 이후
// 생성되는 **모든** 곡선의 경계가 오염된다.
export const DEFAULT_SPENDING_BREAKPOINT_AGES: readonly number[] = Object.freeze([70, 80]);

// 프리셋별 구간 배수. 길이는 언제나 경계 수 + 1이다.
//
// **첫 구간(60대)이 언제나 1.0이다.** 사용자가 목표 단계에서 넣은 금액이 「은퇴 직후에 쓸
// 금액」이라는 뜻이 되도록 기준점을 여기 고정한다. 예전에는 1.0이 가운데 구간(70대)에
// 있어서, 350만원을 넣으면 60대에는 아무도 말하지 않은 420만원이 나갔고 진단 카드의
// 평균도 목표와 어긋났다.
//
// **값의 출처**: 국민연금공단 국민노후보장패널조사(2023)의 «적정생활비» — 건강한 노년을
// 전제로 표준적인 생활을 하는 데 충분하다고 «인식하는» 금액이다.
//
//   부부: 60대 303.5만 / 70대 260.2만 / 80대 이상 230.1만  → 1.00 / 0.857 / 0.758
//   1인: 60대 199.3만 / 70대 170.1만 / 80대 이상 149.4만  → 1.00 / 0.853 / 0.750
//
// 부부와 1인의 비율이 거의 같아 하나의 곡선으로 둔다(front_loaded = 1.00 / 0.86 / 0.76).
// 경계 나이 70·80은 이 통계의 연령 구분과 정확히 일치한다.
//
// care_heavy는 그 감소를 절반쯤만 따라간다 — 여행·외식·교통 같은 활동성 소비는 줄지만
// 의료·돌봄 부담이 커서 총액이 통계만큼 내려가지 않는 경우다. 통계선과 평탄선 사이의
// 보간이며, 이 값 자체에 직접적인 출처는 없다.
//
// **주의**: 이 통계는 실제 소비지출이 아니라 중고령자가 «주관적으로 인식하는» 필요
// 생활비다(조사 기관이 그렇게 명시한다). 그리고 적정생활비에는 보건의료비가 이미
// 포함되어 있으므로, healthcare 항목을 함께 켜면 의료비가 두 번 계산될 수 있다 —
// 그 안내는 「경제 가정」의 의료비 항목에 있다.
const SHAPE_MULTIPLIERS: Record<SpendingShapePreset, readonly number[]> = {
  flat: Object.freeze([1, 1, 1]),
  front_loaded: Object.freeze([1, 0.86, 0.76]),
  care_heavy: Object.freeze([1, 0.93, 0.88]),
};

// 그 나이의 목표 생활비 배수. 곡선이 없으면 1.0이다.
//
// 경계 나이는 **그 나이부터 다음 구간**이다(70이면 70세가 두 번째 구간의 첫 해).
// healthcareCosts의 longTermCareStartAge가 `currentAge >= startAge`로 판정하는 것과 같은
// 규약을 따른다 — 두 연령 스케줄이 다른 경계 규칙을 쓰면 같은 나이에 하나는 켜지고
// 하나는 안 켜지는 상태가 생긴다.
export function spendingMultiplierForAge(curve: SpendingCurve | undefined, age: number): number {
  if (!curve) return 1;

  const index = curve.breakpointAges.findIndex((boundary) => age < boundary);
  // 모든 경계보다 크면 마지막 구간이다.
  const resolved = index === -1 ? curve.multipliers.length - 1 : index;
  const multiplier = curve.multipliers[resolved];

  // 불변식(배수 수 = 경계 수 + 1)이 성립하면 이 분기는 도달할 수 없다. 도달했다는 것은
  // 곡선이 잘못 만들어졌다는 뜻이고, 그때 1.0으로 조용히 메우면 그 구간만 균등 소비로
  // 되돌아간 값이 엔진 목표·이진탐색·효용 분모·차트에 **동시에** 퍼진다. 네 곳이 사이좋게
  // 같은 오답을 쓰므로 어긋남이 드러나지도 않는다("왜 75세만 금액이 튀지?"로만 보인다).
  if (multiplier === undefined) {
    throw new Error(
      `잘못된 생활비 곡선: 경계 ${curve.breakpointAges.length}개에 배수 ${curve.multipliers.length}개`
    );
  }
  return multiplier;
}

// 프리셋을 엔진이 읽는 곡선으로 해소한다.
//
// **'flat'이 undefined를 돌려주는 것이 중요하다.** 배수 1.0을 곱하는 코드 경로조차 타지
// 않아야 곡선을 설정한 적 없는 시나리오의 숫자가 비트 단위로 그대로 남는다. `assetFloor`·
// `cashYieldRate`가 "미지정 = 기존 동작과 비트 단위로 동일"을 규약으로 세운 것과 같다.
// 1.0을 곱해도 부동소수 결과는 같지만, 그 사실에 기대는 대신 경로 자체를 없앤다.
// 경계 나이를 인자로 받지 않는 이유: 배수는 SHAPE_MULTIPLIERS의 고정 길이 3인데 경계만
// 호출자가 정하면 `resolveSpendingCurve('front_loaded', [65,75,85])`처럼 불변식을 깬 곡선이
// 검증 없이 만들어진다. 경계를 조정할 수 있게 하려면 배수도 함께 받아야 하며, 그때는 이
// 함수가 아니라 프리셋 표 자체를 확장하는 것이 맞다.
export function resolveSpendingCurve(shape: SpendingShapePreset | undefined): SpendingCurve | undefined {
  if (!shape || shape === 'flat') return undefined;

  // 타입상 도달 불가로 보이지만 **의도된 방어다** — spendingShape는 E2EE 시나리오 JSON에서
  // 그대로 올라오므로, 프리셋 이름을 바꾸거나 손상된 시나리오를 열면 여기로 온다.
  // 죽은 코드로 보고 지우지 말 것.
  const multipliers = SHAPE_MULTIPLIERS[shape];
  if (!multipliers) return undefined;

  return { breakpointAges: DEFAULT_SPENDING_BREAKPOINT_AGES, multipliers };
}

// 화면이 "60대 580만원 / 70대 480만원"처럼 구간을 나열할 때 쓰는 구간 목록.
// 곡선이 없으면 전 구간이 하나이므로 빈 배열을 돌려준다(나열할 것이 없다).
export interface SpendingCurveSegment {
  fromAge: number;
  toAge: number | null; // null = 기대수명까지
  multiplier: number;
  monthlyAmount: number;
}

export function describeSpendingCurve(
  curve: SpendingCurve | undefined,
  baseMonthlySpending: number,
  retirementAge: number,
  expectancy: number
): SpendingCurveSegment[] {
  if (!curve) return [];

  // 은퇴 전에 끝나는 구간은 보여줄 이유가 없다(은퇴 후에만 목표 생활비가 적용된다).
  const boundaries = curve.breakpointAges.filter((age) => age > retirementAge && age <= expectancy);
  const starts = [retirementAge, ...boundaries];

  return starts.map((fromAge, i) => {
    const next = starts[i + 1];
    const multiplier = spendingMultiplierForAge(curve, fromAge);
    return {
      fromAge,
      toAge: next === undefined ? null : next - 1,
      multiplier,
      monthlyAmount: Math.round(baseMonthlySpending * multiplier),
    };
  });
}

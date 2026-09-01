/**
 * 몬테카를로 성공률의 신뢰구간.
 *
 * **이 구간이 «말하지 않는» 것부터 적는다.** 여기서 나오는 폭은 오로지 «표본»오차다 —
 * 유한한 시행 수로 비율을 추정했기 때문에 생기는 불확실성. 수익률·변동성·세제 가정이
 * 틀렸을 때 생기는 «모형»오차는 이 구간에 조금도 반영되어 있지 않다. 즉 「95% 신뢰구간
 * 84~86%」는 「당신의 계획이 성공할 확률이 84~86%다」가 아니라 「이 가정들이 모두 옳다면,
 * 무한히 많이 돌렸을 때의 값이 84~86%였을 것이다」라는 뜻이다.
 *
 * 시드가 고정이라는 점도 함께 읽어야 한다(MonteCarloConfig.seed). 표본오차가 흔들림이
 * 아니라 고정 편향으로 굳어 있으므로, 이 구간은 「새로고침하면 이만큼 움직인다」는
 * 예고가 아니다. 같은 입력은 언제나 구간이 아니라 «한 점»을 낸다.
 */

/** 신뢰수준. 화면·PDF가 이 값을 문구로 인쇄하므로 상수 하나로 둔다. */
export const CONFIDENCE_LEVEL = 0.95;

// 표준정규 양측 97.5% 분위수. CONFIDENCE_LEVEL과 짝이며, 한쪽만 바꾸면 구간이 조용히
// 거짓말을 한다.
const Z = 1.959964;

export interface ProportionInterval {
  /** 하한(0~1). 판정 불가면 NaN. */
  lower: number;
  /** 상한(0~1). 판정 불가면 NaN. */
  upper: number;
}

export const NO_INTERVAL: ProportionInterval = { lower: Number.NaN, upper: Number.NaN };

/**
 * 비율의 Wilson score 신뢰구간.
 *
 * **Wald(p ± z√(p(1−p)/n))를 쓰지 않는 이유는 양 끝에 있다.** Wald는 p가 0이나 1이면
 * 폭이 정확히 0이 되어 「100% (±0.0%p)」처럼 완전한 확신을 주장한다. 은퇴 계획에서
 * 전 시행 성공은 드물지 않게 나오는 결과라 이 자리에서 실제로 밟는 경로다. Wilson은
 * 같은 경우에 10000회 기준 99.96~100%를 내놓는다 — 「거의 확실하지만 무한하지는 않다」로,
 * 실제로 아는 만큼만 말한다.
 *
 * 가운데 구간에서는 둘이 사실상 같다(10000회·85%에서 Wald ±0.70%p, Wilson 84.29~85.69%).
 * 즉 Wilson을 골라도 흔한 경우의 숫자가 달라지지는 않고, 드문 경우에만 거짓 정밀도가
 * 사라진다.
 */
export function wilsonInterval(successes: number, trials: number): ProportionInterval {
  if (!Number.isFinite(successes) || !Number.isFinite(trials) || trials <= 0) return NO_INTERVAL;

  const p = Math.min(1, Math.max(0, successes / trials));
  const z2 = Z * Z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const half = (Z / denominator)
    * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));

  return {
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
  };
}

/**
 * 비율에서 바로 구간을 낸다.
 *
 * 성공 «횟수»가 아니라 «비율»만 가진 자리를 위한 편의 함수다(spendingSuccessRate 등).
 * 반올림해서 횟수를 되돌리므로 wilsonInterval(succeeded, trials)와 미세하게 다를 수
 * 있으나, 표시 단위(1%p)보다 훨씬 작다.
 */
export function wilsonIntervalFromRate(rate: number, trials: number): ProportionInterval {
  if (!Number.isFinite(rate) || !Number.isFinite(trials) || trials <= 0) return NO_INTERVAL;
  return wilsonInterval(Math.round(rate * trials), trials);
}

/**
 * 구간을 화면·PDF가 그대로 인쇄할 문구로 만든다.
 *
 * 문구를 core가 소유하는 이유는 describeSuccessRates와 같다 — 대시보드와 PDF가 각자
 * 반올림하면 같은 계획이 두 곳에서 다른 구간으로 찍힌다.
 *
 * 판정 불가(NaN)면 문자열이 아니라 null을 낸다. 빈 문자열로 내면 호출부가 무심코
 * 이어 붙여 「 · 」만 남은 꼬리가 화면에 나온다.
 */
export function formatConfidenceInterval(
  interval: ProportionInterval,
  level: number = CONFIDENCE_LEVEL,
): string | null {
  if (!Number.isFinite(interval.lower) || !Number.isFinite(interval.upper)) return null;

  const low = interval.lower * 100;
  const high = interval.upper * 100;
  // 구간이 아주 좁으면(성공률이 0이나 1에 붙을 때) 양 끝이 같은 정수로 반올림돼
  // 「100~100%」가 된다. 폭이 0이라는 «거짓»을 말하느니 한 자리를 더 보여 준다.
  const collapses = Math.round(low) === Math.round(high);
  const show = (value: number) => (collapses ? value.toFixed(1) : String(Math.round(value)));

  return `${Math.round(level * 100)}% 신뢰구간 ${show(low)}~${show(high)}%`;
}

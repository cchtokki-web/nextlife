import { StrategyRecommendation } from '../../entities/types';
import { SensitivityAnalysis, SensitivityScenario } from './computeSensitivityAnalysis';
import { PensionGapRisk } from './computePensionGapRisk';
import { ShortfallReport } from './computeShortfallSummary';

// 「이 계획을 바꾸려면 무엇부터 손대야 하는가」를 영향이 큰 순서로 세운다.
//
// **왜 RecommendationEngine을 확장하지 않고 표시 계층을 얹는가.**
//
// RecommendationEngine이 탐색하는 공간은 «인출 계획» 축뿐이다 — 매도 순서, 일반자산 인출
// 개시 나이, 국민연금 개시 나이, 사적연금 인출 상한(StrategyCandidateGenerator). 은퇴 시점,
// 목표 생활비, 연금 공백 대응은 애초에 후보 격자에 없다. 그래서 실측 리포트에서 AI 추천이
// "배당수익률이 낮은 자산부터 매도" 한 줄로 끝났다 — 같은 화면의 민감도 분석이 "은퇴 3년
// 연기 = 기대수명 시점 자산 +10억"을 이미 계산해 두었는데도.
//
// 그 축들을 옵티마이저에 넣는 것은 별개의 큰 작업이고(은퇴 시점을 바꾸면 적립·인출·연금
// 개시가 전부 연동되어 후보 수가 폭발한다), 지금 필요한 것은 그것이 아니다. **이미 계산된
// 증거를 사용자가 행동할 수 있는 순서로 세우는 것**으로 충분하다. 이 함수는 새 시뮬레이션을
// 한 번도 돌리지 않는다.
//
// **순서는 고정이다(영향 크기로 정렬하지 않는다).** 금액으로 정렬하면 수익률 ±2%p가 늘 1위가
// 되는데, 그것은 사용자가 통제할 수 없는 변수다. 통제 가능성과 확실성 순으로 놓는다 —
// 은퇴 시점(본인이 정한다) → 연금 공백 대응(시점이 확정돼 있다) → 목표 생활비(본인이 정한다)
// → 포트폴리오(기대값만 통제 가능) → 인출 순서(효과는 확실하지만 크기가 가장 작다).
export type KeyLeverKey =
  | 'retirementAge'
  | 'pensionBridge'
  | 'targetSpending'
  | 'investmentReturn'
  | 'withdrawalOrder';

export interface KeyLever {
  key: KeyLeverKey;
  title: string;
  // 근거가 되는 수치를 반드시 포함한 한 문장. 수치 없는 조언은 이 저장소가 이미 거부한 형태다.
  detail: string;
}

export interface KeyLeversInput {
  sensitivity: SensitivityAnalysis;
  pensionGap: PensionGapRisk | null;
  shortfall: ShortfallReport;
  recommendation?: StrategyRecommendation;
  formatValue: (val: number) => string;
}

const LEVER_ORDER: KeyLeverKey[] = [
  'retirementAge',
  'pensionBridge',
  'targetSpending',
  'investmentReturn',
  'withdrawalOrder',
];

export function computeKeyLevers(input: KeyLeversInput): KeyLever[] {
  const builders: Record<KeyLeverKey, () => KeyLever | null> = {
    retirementAge: () => buildRetirementAgeLever(input),
    pensionBridge: () => buildPensionBridgeLever(input),
    targetSpending: () => buildTargetSpendingLever(input),
    investmentReturn: () => buildInvestmentReturnLever(input),
    withdrawalOrder: () => buildWithdrawalOrderLever(input),
  };

  return LEVER_ORDER.map((key) => builders[key]()).filter((lever): lever is KeyLever => lever !== null);
}

function findScenario(
  sensitivity: SensitivityAnalysis,
  key: SensitivityScenario['key']
): SensitivityScenario | undefined {
  return sensitivity.scenarios.find((s) => s.key === key);
}

// 시나리오 하나를 "무슨 일이 일어나는가" 한 조각으로 옮긴다. 고갈이 있으면 금액보다 그쪽이
// 훨씬 강한 신호이므로 먼저 말한다.
function describeScenario(scenario: SensitivityScenario, formatValue: (v: number) => string): string {
  if (scenario.depletionAge !== null) return `${scenario.depletionAge}세 자산 고갈`;
  if (scenario.unmetSpendingYears > 0) return `생활비 부족 ${scenario.unmetSpendingYears}년`;
  const sign = scenario.endingAssetsDelta >= 0 ? '+' : '−';
  return `기대수명 시점 자산 ${sign}${formatValue(Math.abs(scenario.endingAssetsDelta))}`;
}

function buildRetirementAgeLever({ sensitivity, formatValue }: KeyLeversInput): KeyLever | null {
  const later = findScenario(sensitivity, 'retirementLater');
  const earlier = findScenario(sensitivity, 'retirementEarlier');
  if (!later && !earlier) return null;

  const parts: string[] = [];
  if (later) parts.push(`3년 늦추면 ${describeScenario(later, formatValue)}`);
  if (earlier) parts.push(`3년 앞당기면 ${describeScenario(earlier, formatValue)}`);

  return {
    key: 'retirementAge',
    title: '은퇴 시점 조정',
    // 왜 이렇게 크게 갈리는지를 밝히지 않으면 사용자는 과장된 결과로 읽는다.
    detail:
      `${parts.join(' / ')}. 추가 적립·추가 운용기간·인출 지연·연금 공백 단축이 동시에 작용해 ` +
      '다른 어떤 변수보다 효과가 큽니다.',
  };
}

function buildPensionBridgeLever({ pensionGap, formatValue }: KeyLeversInput): KeyLever | null {
  if (pensionGap === null) return null;
  const detail = pensionGap.shortfallYears > 0
    ? `${pensionGap.years}년의 공백 중 ${pensionGap.shortfallYears}년은 계획 생활비가 월 평균 ` +
      `${formatValue(pensionGap.averageMonthlyShortfall)} 부족합니다. 공백기 실제 자산인출 ` +
      `${formatValue(pensionGap.assetWithdrawalAmount)}과 미충족 생활비 추가 필요액 ` +
      `${formatValue(pensionGap.shortfallAmount)}을 구분해 보세요. 둘을 합친 총 필요자금 ` +
      `약 ${formatValue(pensionGap.bridgeAmount)}을 65세 이전에 사용할 수 있게 준비하세요.`
    : `국민연금 개시 전 ${pensionGap.years}년간 월 평균 ${formatValue(pensionGap.monthlyAssetWithdrawal)}을 ` +
      `자산에서 인출합니다. 이 구간용 자금 약 ${formatValue(pensionGap.bridgeAmount)}을 변동성이 낮은 ` +
      '자산으로 따로 확보해 두면, 하필 이 시기에 하락장이 와도 싼 값에 팔지 않아도 됩니다.';
  return {
    key: 'pensionBridge',
    title: `${pensionGap.fromAge}~${pensionGap.toAge}세 연금 공백 대비`,
    detail,
  };
}

function buildTargetSpendingLever({ shortfall, formatValue }: KeyLeversInput): KeyLever | null {
  const { goal, goalMonthlySpending, sustainableMonthlySpending } = shortfall;
  // 목표와 지속가능액이 사실상 같으면 조정할 것이 없다.
  if (goal === null || sustainableMonthlySpending >= goalMonthlySpending) return null;

  return {
    key: 'targetSpending',
    title: '목표 생활비 조정',
    detail:
      `목표 월 ${formatValue(goalMonthlySpending)}에 대해 지속 가능한 수준은 월 ` +
      `${formatValue(sustainableMonthlySpending)}입니다(월 평균 ${formatValue(goal.averageMonthlyShortfall)} 차이). ` +
      `목표를 그대로 채우려면 약 ${formatValue(goal.totalShortfallInTodayValue)}이 더 필요합니다.`,
  };
}

function buildInvestmentReturnLever({ sensitivity, formatValue }: KeyLeversInput): KeyLever | null {
  const up = findScenario(sensitivity, 'yieldAggressive');
  const down = findScenario(sensitivity, 'yieldConservative');
  if (!up && !down) return null;

  const parts: string[] = [];
  if (up) parts.push(`공격형 가정(주식 9%)이면 ${describeScenario(up, formatValue)}`);
  if (down) parts.push(`안정형 가정(주식 5%)이면 ${describeScenario(down, formatValue)}`);

  return {
    key: 'investmentReturn',
    title: '투자 포트폴리오 조정',
    // 수익률은 «정하는» 것이 아니라 «기대하는» 것이다. 그 구분을 밝히지 않으면 이 항목이
    // "수익률을 정하세요"라는 실행 지시로 읽힌다. 두 방향(안정형 5% / 공격형 9%)은 사용자의
    // 현재 가정이 무엇이든 고정된 앵커다 — 폭이 사용자 가정 주변 ±2%p로 함께 움직이지 않는다.
    // 「현재 가정과 무관하게 고정된 기준」이라고 말해 놓고 그 «현재 가정»이 얼마인지는
    // 어디에도 없었다. 사용자 가정이 9%보다 높으면 두 방향이 모두 나빠 보이는데, 그 이유를
    // 아는 유일한 단서가 그 숫자다. 새로 계산하지 않는다 — 몬테카를로 변동성 유도가 쓰는
    // 것과 같은 잔액가중 평균이 sensitivity에 이미 실려 온다.
    detail:
      `${parts.join(' / ')}. 다만 수익률은 정할 수 있는 값이 아니라 자산 배분의 결과이며, ` +
      '위 두 방향(안정형 5% / 공격형 9%)은 현재 가정과 무관하게 고정된 비교 기준입니다'
      + (sensitivity.baselineWeightedTotalReturn === null
        ? '.'
        // 「사적연금 포함」을 반드시 붙인다. 이 평균은 연금까지 넣은 값이라 「주식 9%」와 곧바로
        // 견주면 어긋난다 — 프리셋은 연금 수익률도 함께 갈아끼운다.
        : ` (현재 가정은 사적연금을 포함한 가중평균 총수익률 ${
          Math.round(sensitivity.baselineWeightedTotalReturn * 10) / 10}%입니다).`),
  };
}

// **평생 효용 점수를 인용하지 않는다.** 효용은 후보를 서로 비교하기 위한 내부 척도라
// 사용자가 "+5점"의 크기를 가늠할 기준이 없고, 결과 화면에서도 더 이상 노출하지 않는다.
// 대신 같은 항목이 이미 들고 있는 절세액·자산 증감을 근거로 쓴다 — 단위가 금액이라
// 다른 레버(은퇴 시점·생활비)의 근거와 같은 자로 읽힌다.
//
// 근거 수치가 하나도 없으면 레버를 만들지 않는다. 수치 없는 조언은 이 저장소가 이미
// 거부한 형태이고, 그런 항목은 "라벨만 있는 5순위"로 남아 목록의 신뢰도만 떨어뜨린다.
function buildWithdrawalOrderLever({ recommendation, formatValue }: KeyLeversInput): KeyLever | null {
  const top = recommendation?.itemizedContributions?.[0];
  if (!recommendation?.improved || top === undefined) return null;

  const effects: string[] = [];
  if (top.deltas.totalTax < 0) effects.push(`절세 ${formatValue(-top.deltas.totalTax)}`);
  else if (top.deltas.totalTax > 0) effects.push(`추가 세금 ${formatValue(top.deltas.totalTax)}`);
  if (top.deltas.endingAssets !== 0) {
    effects.push(
      `기말자산 ${top.deltas.endingAssets >= 0 ? '+' : '−'}${formatValue(Math.abs(top.deltas.endingAssets))}`
    );
  }
  if (effects.length === 0) return null;

  return {
    key: 'withdrawalOrder',
    title: '인출 순서 최적화',
    detail: `${top.label} (${effects.join(' · ')}).`,
  };
}

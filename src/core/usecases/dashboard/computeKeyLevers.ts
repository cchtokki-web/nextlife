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
  return {
    key: 'pensionBridge',
    title: `${pensionGap.fromAge}~${pensionGap.toAge}세 연금 공백 대비`,
    detail:
      `국민연금 개시 전 ${pensionGap.years}년간 월 평균 ${formatValue(pensionGap.monthlyAssetWithdrawal)}을 ` +
      `자산에서 인출합니다. 이 구간용 자금 약 ${formatValue(pensionGap.bridgeAmount)}을 변동성이 낮은 ` +
      '자산으로 따로 확보해 두면, 하필 이 시기에 하락장이 와도 싼 값에 팔지 않아도 됩니다.',
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
  const up = findScenario(sensitivity, 'returnUp');
  const down = findScenario(sensitivity, 'returnDown');
  if (!up && !down) return null;

  const parts: string[] = [];
  if (up) parts.push(`+2%p면 ${describeScenario(up, formatValue)}`);
  if (down) parts.push(`−2%p면 ${describeScenario(down, formatValue)}`);

  return {
    key: 'investmentReturn',
    title: '투자 포트폴리오 조정',
    // 수익률은 «정하는» 것이 아니라 «기대하는» 것이다. 그 구분을 밝히지 않으면 이 항목이
    // "수익률을 2%p 올리세요"라는 실행 불가능한 조언으로 읽힌다.
    detail:
      `연 수익률 ${parts.join(' / ')}. 다만 수익률은 정할 수 있는 값이 아니라 자산 배분의 결과이며, ` +
      '기대수익을 높이면 위 두 방향의 폭도 함께 커집니다.',
  };
}

function buildWithdrawalOrderLever({ recommendation }: KeyLeversInput): KeyLever | null {
  const top = recommendation?.itemizedContributions?.[0];
  if (!recommendation?.improved || top === undefined) return null;

  return {
    key: 'withdrawalOrder',
    title: '인출 순서 최적화',
    detail: `${top.label} (평생 효용 ${top.utilityDelta >= 0 ? '+' : ''}${top.utilityDelta}점). 아래 체크리스트에서 전체 항목을 확인하세요.`,
  };
}

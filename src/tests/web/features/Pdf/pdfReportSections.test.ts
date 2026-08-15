import { describe, test, expect } from 'vitest';
import {
  formatCurrencyUnit,
  renderRiskAlertsSection,
  renderStrategyRecommendationSection,
  renderExecutionRoadmapSection,
  renderSensitivityTableSection,
  renderMonteCarloSection,
  renderShortfallSummarySection,
  renderPlanVerdictSection,
} from '@/web/features/Pdf/pdfReportSections';
import { ShortfallReport } from '@/core/usecases/dashboard/computeShortfallSummary';
import { computePlanConfidence } from '@/core/usecases/dashboard/computePlanConfidence';

describe('formatCurrencyUnit', () => {
  test('replaces currency codes with report-facing symbols', () => {
    expect(formatCurrencyUnit('KRW')).toBe('원');
    expect(formatCurrencyUnit('USD')).toBe('$');
  });
});

// 화면(ShortfallSummaryCard)과 같은 값·같은 각주를 써야 한다 — 같은 계획의 두 문서가
// 다른 이야기를 하면 안 된다.
describe('renderShortfallSummarySection', () => {
  const won = (v: number) => `${v.toLocaleString()}원`;
  const summary = (overrides = {}) => ({
    shortfallYears: 3, firstShortfallAge: 60, lastShortfallAge: 62,
    averageMonthlyShortfall: 1180000, totalShortfallInTodayValue: 42480000, ...overrides,
  });
  const report = (overrides: Partial<ShortfallReport> = {}): ShortfallReport => ({
    goal: summary(), plan: summary(),
    goalMonthlySpending: 3500000, sustainableMonthlySpending: 3500000, ...overrides,
  });

  test('부족이 전혀 없으면 빈 문자열을 반환한다', () => {
    expect(renderShortfallSummarySection(report({ goal: null, plan: null }), won)).toBe('');
    expect(renderShortfallSummarySection(null, won)).toBe('');
  });

  test('목표 기준 블록에 목표·지속가능·부족 세 금액을 모두 싣는다', () => {
    const html = renderShortfallSummarySection(
      report({ plan: null, sustainableMonthlySpending: 2320000 }), won
    );

    expect(html).toContain('목표 생활비 기준');
    expect(html).toContain(won(3500000));
    expect(html).toContain(won(2320000));
    expect(html).toContain(won(1180000));
  });

  // 「평생 소비 최적화」에서 계획 기준 부족이 없으면 "부족 생활비 월 0원"을 찍는 대신
  // 그 계획이 무엇을 보장하는지 말한다.
  // **결정론 결과를 확정형으로 말하지 않는다.** 예전 문구("월 232만원 소비 시에는 자산이
  // 계획대로 유지됩니다")는 기준 수익률이 실현될 때에만 참인데 조건이 어디에도 없었고,
  // 같은 리포트의 성공률은 39%였다.
  test('계획 기준 부족이 없으면 조건과 확률을 나눠 밝힌다', () => {
    const html = renderShortfallSummarySection(
      report({ plan: null, sustainableMonthlySpending: 2320000 }), won,
      { expectancy: 90, spendingSuccessRate: 0.39 }
    );

    expect(html).not.toContain('계획한 생활비조차 채우지 못하는 구간');
    expect(html).toContain('기준 수익률이 실현된다는 가정에서는');
    expect(html).toContain('90세까지 계획이 유지됩니다');
    expect(html).toContain('생활 유지 성공률');
    expect(html).toContain('39%');
    // 확정형 표현이 되살아나면 여기서 잡힌다.
    expect(html).not.toContain('자산이 계획대로 유지됩니다');
  });

  test('계획 기준 부족이 있으면 부족 생활비·기간·필요 자산을 싣는다', () => {
    const html = renderShortfallSummarySection(report(), won);

    expect(html).toContain('계획한 생활비조차 채우지 못하는 구간');
    expect(html).toContain('부족 기간');
    expect(html).toContain('60세 ~ 62세');
    expect(html).toContain('추가로 필요한 자산');
  });

  test('수익률 가정 각주를 반드시 붙인다', () => {
    expect(renderShortfallSummarySection(report(), won)).toContain('수익률이 물가상승률과 같다고 볼 때');
  });
});
import { RiskAlert } from '@/core/usecases/dashboard/computeRiskAlerts';
import { ExecutionRoadmap } from '@/core/usecases/dashboard/computeExecutionRoadmap';
import { MonteCarloResult } from '@/core/entities/montecarlo';
import { SequenceRiskResult } from '@/core/usecases/montecarlo/sequenceRisk';
import { SensitivityScenario } from '@/core/usecases/dashboard/computeSensitivityAnalysis';
import { SimulationParams } from '@/core/entities/types';
import { CandidateRecommendation, ValidatedStrategyCandidate } from '@/core/recommendation/RecommendationEngine';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { NO_GOAL_FAILURE, LEGACY_GOAL_CONDITIONS } from '@/tests/fixtures/goalFailure';

describe('renderRiskAlertsSection', () => {
  test('빈 배열이면 빈 문자열을 반환한다', () => {
    expect(renderRiskAlertsSection([])).toBe('');
  });

  test('알림 목록을 HTML로 렌더링한다', () => {
    const alerts: RiskAlert[] = [
      {
        key: 'comprehensiveTax',
        title: '금융소득종합과세 진입 가능성',
        message: '65세 이후 배당·이자소득이 연 2,000만원을 초과하는 해가 있습니다.',
      },
    ];
    const html = renderRiskAlertsSection(alerts);
    expect(html).toContain('금융소득종합과세 진입 가능성');
    expect(html).toContain('65세 이후 배당·이자소득이 연 2,000만원을 초과하는 해가 있습니다.');
  });
});

// 예전 이 자리에는 레거시 「🤖 AI 추천 전략」 체크리스트가 있었다. 그쪽은 평생 효용 점수로
// 항목을 정렬했는데, 화면은 이미 목표 달성 확률로 말하는 다른 추천을 내고 있어 같은 계획의
// 두 문서가 서로 다른 축으로 서로 다른 전략을 권했다.
describe('renderStrategyRecommendationSection', () => {
  const params: SimulationParams = {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 1_500_000 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    yieldPreset: 'base',
    withdrawalPlan: { nationalPensionStartAge: 60, accountWithdrawalPolicy: 'GENERAL_FIRST' },
  };
  const formatValue = (value: number) => `${Math.round(value / 10_000)}만원`;

  const candidate = (rank: number, probability: number): ValidatedStrategyCandidate => ({
    rank,
    candidate: {
      id: `candidate-${rank}`,
      dimensions: {
        retirementAge: 62,
        nationalPensionTiming: 'NORMAL',
        nationalPensionStartAge: 65,
        withdrawalPolicy: 'ISA_FIRST',
        spendingPattern: 'FIXED',
        assetAllocation: 'BALANCED',
      },
      strategy: {
        targetMonthlySpending: 3_500_000,
        planHorizonAge: 90,
        simulationStartYear: 2026,
        retirementAge: 62,
        nationalPensionStartAge: 65,
        withdrawalPolicy: { accountWithdrawalPolicy: 'ISA_FIRST' },
        spendingPolicy: { mode: 'target' },
        legacySettings: {
          inflationRate: 2, inflationMode: 'real', baseExchangeRate: 1350,
          exchangeScenario: 'base', displayCurrency: 'KRW', yieldPreset: 'base',
        },
        legacyPresence: {
          withdrawalPlan: true, spendingStrategy: false, spendingCurve: false, assetFloor: false,
        },
        utilityConfig: DEFAULT_UTILITY_CONFIG,
      },
    },
    simulation: { yearlyResults: [], depletionAge: null, endingAssets: 200_000_000 },
    evaluation: {
      hardConstraintsSatisfied: true, goalEvaluations: [], weightedScore: 80, score: 80,
      utility: { score: 80, components: { consumption: 0, depletionSafety: 0, pensionUtilization: 0, taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0 } },
      hardConstraintFailures: [], unsupportedHardGoals: [],
    },
    monteCarlo: {
      trials: 1000, seed: 20260101,
      goalSuccessProbability: probability,
      spendingSuccessProbability: probability,
      assetSurvivalProbability: probability,
      terminalAssetMedian: 300_000_000,
      terminalAssetP10: 100_000_000,
      terminalAssetP90: 500_000_000,
      shortfallProbability: 1 - probability,
    },
  });

  const balanced: CandidateRecommendation = {
    persona: 'BALANCED', label: '균형형', candidate: candidate(1, 0.94),
    reason: '목표 성공확률과 목표 적합도, 자산배분의 균형을 우선했습니다.',
  };

  test('페르소나 카드와 달라지는 점을 싣는다', () => {
    const html = renderStrategyRecommendationSection({
      recommendations: [balanced], status: 'done', params, formatValue,
    });

    expect(html).toContain('균형형');
    expect(html).toContain('94%');
    expect(html).toContain('현재 계획에서 달라지는 점');
  });

  // 「현재 계획 N% → 추천 전략 적용 M%」 요약 바는 화면과 함께 걷어냈다. 두 숫자 모두 같은
  // 리포트의 다른 자리(계획 진단·추천 카드)에 이미 있어, 같은 값을 세 번 적는 셈이었다.
  test('현재 계획 → 추천 전략 요약 바를 싣지 않는다', () => {
    const html = renderStrategyRecommendationSection({
      recommendations: [balanced], status: 'done', params, formatValue,
    });

    expect(html).not.toContain('추천 전략 적용');
  });

  // 확률 이름은 화면·리포트를 통틀어 「목표 달성 확률」 하나다. 같은 값에 이름이 여럿이면
  // 사용자는 서로 다른 지표로 읽는다.
  test('확률을 「목표 달성 확률」이라는 한 이름으로만 부른다', () => {
    const html = renderStrategyRecommendationSection({
      recommendations: [balanced], status: 'done', params, formatValue,
    });

    expect(html).toContain('목표 달성 확률');
    expect(html).not.toContain('목표 성공확률 ');
    expect(html).not.toContain('현재 목표 달성률');
  });

  // 화면(describeStrategyChanges)과 같은 함수를 쓰므로 같은 변경 목록이 나와야 한다.
  test('현재 설정과 다른 축만 달라지는 점으로 싣는다', () => {
    const html = renderStrategyRecommendationSection({
      recommendations: [balanced], status: 'done', params, formatValue,
    });

    expect(html).toContain('은퇴 시점');
    expect(html).toContain('국민연금');
    expect(html).toContain('자산 인출');
    expect(html).not.toContain('월 생활비');
  });

  // 워커가 끝나기 전에 내려받으면 추천 자리가 통째로 빈다. 조용히 생략하면 "추천할 것이 없는
  // 계획"으로 읽힌다.
  test('아직 검증되지 않았으면 생략하지 않고 그 사실을 밝힌다', () => {
    const html = renderStrategyRecommendationSection({ status: 'running', params, formatValue });

    expect(html).toContain('아직 계산되지 않았습니다');
  });

  test('후보가 없는 원인을 하나로 뭉뚱그리지 않는다', () => {
    const html = renderStrategyRecommendationSection({
      recommendations: [], status: 'done', params, formatValue,
      outcome: {
        kind: 'no_candidate_survived',
        hardConstraintRejectedCount: 3,
        failedCount: 0,
        blockedBy: ['HARD_ASSET_SURVIVAL'],
      },
    });

    expect(html).toContain('자산 고갈 방지');
    expect(html).not.toContain('입력만으로는 비교할 전략을 만들지 못했습니다');
  });

  // 리포트는 화면보다 오래 남고 그대로 인용된다. 고를 이유가 없는 선택지를 표로 남기면
  // 화면에서 걷어낸 오해가 리포트에만 살아남는다.
  test('추천이 전부 0%면 전략 표 대신 격차를 싣는다', () => {
    const zero: CandidateRecommendation = {
      ...balanced, candidate: candidate(1, 0),
    };
    const html = renderStrategyRecommendationSection({
      recommendations: [zero], status: 'done', params, formatValue,
      outcome: { kind: 'no_candidate_reaches_goal', validatedCount: 12, personaCount: 1 },
      sustainableSpendingAdvice: {
        kind: 'overspending',
        currentMonthly: 3_000_000,
        sustainableMonthly: 2_000_000,
        difference: 1_000_000,
      },
    });

    expect(html).toContain('어떤 전략으로도 목표에 도달하지 못합니다');
    expect(html).toContain('전략 12개를 검증했지만');
    expect(html).toContain('지속 가능한 월 생활비');
    expect(html).not.toContain('균형형');
    expect(html).not.toContain('추천 전략 적용');
    expect(html).not.toContain('현재 계획에서 달라지는 점');
  });

  test('지속 가능한 생활비를 구하지 못했으면 격차를 숫자로 지어내지 않는다', () => {
    const html = renderStrategyRecommendationSection({
      recommendations: [{ ...balanced, candidate: candidate(1, 0) }], status: 'done', params, formatValue,
      outcome: { kind: 'no_candidate_reaches_goal', validatedCount: 12, personaCount: 1 },
      sustainableSpendingAdvice: null,
    });

    expect(html).toContain('어떤 전략으로도 목표에 도달하지 못합니다');
    expect(html).not.toContain('지속 가능한 월 생활비');
  });

  // 검증하지 못한 필수 목표를 밝히지 않으면 "확인하지 않음"이 "확인해서 통과함"으로 읽힌다.
  // 리포트는 화면보다 오래 남고 그대로 인용되므로 더 중요하다.
  test('검증할 수 없었던 HARD 목표를 밝힌다', () => {
    const html = renderStrategyRecommendationSection({
      recommendations: [balanced], status: 'done', params, formatValue,
      unsupportedHardGoals: ['TAX_OPTIMIZATION'],
    });

    expect(html).toContain('검증할 수 없습니다');
    expect(html).toContain('세금 최소화');
  });
});

describe('renderExecutionRoadmapSection', () => {
  test('이벤트와 기대수명을 렌더링한다', () => {
    const roadmap: ExecutionRoadmap = {
      events: [
        { age: 60, items: [{ title: '퇴직', description: '상용소득이 종료되고 자산 인출 계획이 시작됩니다.' }] },
        { age: 68, items: [{ title: '국민연금 수령 개시 (연기)', description: '국민연금 수령을 시작합니다.' }] },
      ],
      endAge: 90,
      endLabel: '기대수명',
    };
    const html = renderExecutionRoadmapSection(roadmap);
    expect(html).toContain('60세');
    expect(html).toContain('퇴직');
    expect(html).toContain('68세');
    expect(html).toContain('국민연금 수령 개시 (연기)');
    expect(html).toContain('90세');
    expect(html).toContain('기대수명');
  });

  test('severity가 warning인 이벤트는 danger 색상(#EF4444)으로 렌더링된다', () => {
    const roadmap: ExecutionRoadmap = {
      events: [
        {
          age: 78,
          items: [{ title: '자산 고갈 예상', description: '누적 자산이 모두 소진됩니다.', severity: 'warning' }],
        },
      ],
      endAge: 90,
      endLabel: '기대수명',
    };
    const html = renderExecutionRoadmapSection(roadmap);
    expect(html).toContain('#EF4444');
    expect(html).toContain('자산 고갈 예상');
  });
});

describe('renderSensitivityTableSection', () => {
  test('빈 배열이면 빈 문자열을 반환한다', () => {
    expect(renderSensitivityTableSection([])).toBe('');
  });

  test('시나리오를 표 행으로 렌더링하며, depletionAge가 null이면 "평생 유지"를 표시한다', () => {
    const scenarios: SensitivityScenario[] = [
      { key: 'returnDown', label: '투자수익률 -2%p', depletionAge: 82, deltaYears: -6,
        endingAssets: 0, endingAssetsDelta: -2500000000, unmetSpendingYears: 8 },
      { key: 'returnUp', label: '투자수익률 +2%p', depletionAge: null, deltaYears: 4,
        endingAssets: 5000000000, endingAssetsDelta: 2500000000, unmetSpendingYears: 0 },
    ];
    const html = renderSensitivityTableSection(scenarios);
    expect(html).toContain('투자수익률 -2%p');
    expect(html).toContain('82세');
    expect(html).toContain('투자수익률 +2%p');
    expect(html).toContain('평생 유지');
  });

  // 고갈이 전혀 없는 계획에서 예전 표는 6행이 모두 "평생 유지" 한 단어뿐이라 아무 정보도
  // 주지 못했다. 기말자산 열이 그 구분을 만든다.
  test('고갈이 없어도 기말자산과 증감으로 시나리오가 구분된다', () => {
    const scenarios: SensitivityScenario[] = [
      { key: 'returnDown', label: '투자수익률 -2%p', depletionAge: null, deltaYears: null,
        endingAssets: 820000000, endingAssetsDelta: -1680000000, unmetSpendingYears: 0 },
      { key: 'returnUp', label: '투자수익률 +2%p', depletionAge: null, deltaYears: null,
        endingAssets: 5100000000, endingAssetsDelta: 2600000000, unmetSpendingYears: 0 },
    ];
    const html = renderSensitivityTableSection(scenarios);

    expect(html).toContain('8억 2,000만원');
    expect(html).toContain('51억원');
    expect(html).toContain('-16억 8,000만원');
    expect(html).toContain('+26억원');
  });

  // 화면(SensitivityAnalysisSection)과 같은 규칙이어야 한다 — 두 문서가 서로 다른 표를
  // 보여주면 안 된다.
  test('투자자산이 없으면 결과가 baseline과 동일한 행을 접고 몇 개를 접었는지 밝힌다', () => {
    const scenarios: SensitivityScenario[] = [
      { key: 'returnDown', label: '투자수익률 -2%p', depletionAge: 51, deltaYears: 0,
        endingAssets: 0, endingAssetsDelta: 0, unmetSpendingYears: 31 },
      { key: 'returnUp', label: '투자수익률 +2%p', depletionAge: 51, deltaYears: 0,
        endingAssets: 0, endingAssetsDelta: 0, unmetSpendingYears: 31 },
      { key: 'retirementLater', label: '은퇴시점 +3년', depletionAge: 51, deltaYears: 0,
        endingAssets: 0, endingAssetsDelta: 0, unmetSpendingYears: 28 },
    ];

    const html = renderSensitivityTableSection(scenarios, {
      depletionAge: 51,
      unmetSpendingYears: 31,
      planAssetStatus: 'no_investable_asset',
    });

    expect(html).not.toContain('투자수익률 -2%p');
    expect(html).not.toContain('투자수익률 +2%p');
    expect(html).toContain('은퇴시점 +3년');
    expect(html).toContain('투자자산이 없어');
    expect(html).toContain('2개 가정은 생략');
  });

  test('투자자산이 있으면 baseline 정보를 넘겨도 행을 접지 않는다', () => {
    const scenarios: SensitivityScenario[] = [
      { key: 'returnDown', label: '투자수익률 -2%p', depletionAge: null, deltaYears: null,
        endingAssets: 820000000, endingAssetsDelta: -1680000000, unmetSpendingYears: 0 },
    ];

    const html = renderSensitivityTableSection(scenarios, {
      depletionAge: null,
      unmetSpendingYears: 0,
      planAssetStatus: 'sustained',
    });

    expect(html).toContain('투자수익률 -2%p');
    expect(html).not.toContain('생략');
  });

  test('생활비를 채우지 못한 해가 있으면 표에 함께 적는다', () => {
    const scenarios: SensitivityScenario[] = [
      { key: 'returnDown', label: '투자수익률 -2%p', depletionAge: null, deltaYears: null,
        endingAssets: 100000000, endingAssetsDelta: -500000000, unmetSpendingYears: 5 },
    ];

    expect(renderSensitivityTableSection(scenarios)).toContain('생활비 부족 5년');
  });
});

// **1페이지가 결정론 결과만 크게 말하던 문제.**
//
// 예전 1페이지는 "은퇴 준비도 64점(주의)"와 "기대수명까지 고갈 없음"을 나란히 놓았고,
// "1,000회 중 37%만 남음"은 여섯 페이지 뒤에 있었다. 앞의 두 문장은 결정론 기준
// 시나리오에서만 참인데 그 조건이 어디에도 적혀 있지 않았다.
describe('renderPlanVerdictSection', () => {
  const won = (v: number) => `${v.toLocaleString()}원`;
  const mc = (successRate: number, p50 = 0, p10 = 0): MonteCarloResult => ({
    trials: 1000, seed: 1, successAge: 90, successRate, spendingSuccessRate: successRate,
    goalSuccessProbability: successRate,
    goalFailure: NO_GOAL_FAILURE, goalConditions: LEGACY_GOAL_CONDITIONS,
    plannedMonthlySpending: 3000000,
    endingAssets: { p10, p50, p90: 977090000, mean: 300000000 },
    assetBand: [], depletion: { count: 630, earliestAge: 72, medianAge: 84 },
    deterministicEndingAssets: 0, worstDecilePath: [],
  });
  const render = (successRate?: number, monteCarlo?: MonteCarloResult) =>
    renderPlanVerdictSection({
      expectancy: 90,
      deterministicDepletionText: '기대수명까지 고갈 없음',
      endingAssets: 0,
      confidence: computePlanConfidence(
        64,
        successRate === undefined
          ? undefined
          : { spendingSuccessRate: successRate, assetSuccessRate: successRate }
      ),
      monteCarlo,
      formatValue: won,
    });

  test('기준 시나리오 결과에 "가정대로 실현될 때"라는 조건을 붙인다', () => {
    const html = render(0.37, mc(0.37));

    expect(html).toContain('가정대로 실현될 때');
    expect(html).toContain('기대수명까지 고갈 없음');
  });

  // 리포트가 지적한 핵심: 두 세계가 각각 이름을 갖고 같은 블록에 놓여야 한다.
  test('결정론 결과와 확률 결과를 같은 블록에 나란히 싣는다', () => {
    const html = render(0.37, mc(0.37));

    expect(html).toContain('가정대로 실현될 때');
    expect(html).toContain('시장 변동성 반영');
    expect(html).toContain('1,000회 시뮬레이션');
    expect(html).toContain('목표 달성 확률 37%');
  });

  // **판정 블록은 목표 달성 확률 하나만 말한다.** 성분 확률(생활 유지·자산 보존)과 잔여자산
  // 분위수는 「시장 변동 검증」 섹션이 소유한다 — 예전에는 여기서 먼저 인쇄하고 뒤 페이지에서
  // 같은 숫자를 다시 인쇄했다.
  test('성분 확률과 잔여자산 분위수를 여기서 다시 인쇄하지 않는다', () => {
    const html = render(0.37, mc(0.37, 100000000, 5000000));

    expect(html).not.toContain('생활 유지 37%');
    expect(html).not.toContain('자산 보존 37%');
    expect(html).not.toContain('중앙값');
    expect(html).not.toContain('하위 10%');
  });

  test('판정에는 보정 점수와 결정론 점수를 함께 밝힌다', () => {
    const html = render(0.37, mc(0.37));

    expect(html).toContain('은퇴계획 조정을 권합니다');
    expect(html).toContain('44점'); // round(64 * (0.5 + 0.5*0.37))
    expect(html).toContain('위험');
    expect(html).toContain('기준 시나리오만 보면 64점');
  });

  test.each([
    [0.95, '현재 계획을 유지해도 좋습니다'],
    [0.85, '대체로 안정적입니다'],
    [0.75, '유지되지만 여유가 크지는 않습니다'],
    [0.6, '점검이 필요합니다'],
    [0.4, '은퇴계획 조정을 권합니다'],
    [0.2, '은퇴계획을 다시 세워야 합니다'],
  ])('성공률 %s의 판정 문장', (rate, text) => {
    expect(render(rate, mc(rate))).toContain(text);
  });

  // 예전에는 워커가 늦으면 시장 변동성 페이지 자체가 사라져, 리포트가 결정론 결과만 담은
  // 채로 완결된 문서처럼 보였다. 조용히 생략하지 않는다.
  test('MC가 없으면 생략하지 않고 계산되지 않았다고 밝힌다', () => {
    const html = render(undefined, undefined);

    expect(html).toContain('시장 변동성 반영');
    expect(html).toContain('아직 계산되지 않았습니다');
    expect(html).toContain('확률 판정 보류');
    expect(html).toContain('시장 변동성 미반영');
    expect(html).not.toContain('유지 확률');
  });
});

describe('renderMonteCarloSection', () => {
  const monteCarlo: MonteCarloResult = {
    trials: 1000, seed: 1, annualStdDev: 18, successAge: 90, successRate: 0.87, spendingSuccessRate: 0.81,
    goalSuccessProbability: 0.81,
    goalFailure: NO_GOAL_FAILURE, goalConditions: LEGACY_GOAL_CONDITIONS,
    plannedMonthlySpending: 3000000,
    endingAssets: { p10: 200000000, p50: 1800000000, p90: 5200000000, mean: 2100000000 },
    assetBand: [
      { age: 60, p10: 400000000, p50: 480000000, p90: 560000000 },
      { age: 70, p10: 350000000, p50: 900000000, p90: 1600000000 },
      { age: 90, p10: 200000000, p50: 1800000000, p90: 5200000000 },
    ],
    depletion: { count: 130, earliestAge: 79, medianAge: 86 },
    deterministicEndingAssets: 2500000000,
    worstDecilePath: [],
  };

  const sequenceRisk: SequenceRiskResult = {
    cases: [
      { key: 'deterministic', label: '변동 없음 (기준)', endingAssets: 2500000000, depletionAge: null, yearlyTotalAssets: [] },
      { key: 'bestFirst', label: '좋은 해가 먼저', endingAssets: 4100000000, depletionAge: null, yearlyTotalAssets: [] },
      { key: 'worstFirst', label: '나쁜 해가 먼저', endingAssets: 600000000, depletionAge: 88, yearlyTotalAssets: [] },
    ],
    orderingSpread: 3500000000,
    sharedMeanShock: 0.02,
  };

  // 데이터가 없으면 빈 문자열을 준다 — 워커가 아직 끝나지 않았거나 실패한 경우다.
  // 개별 실패를 무시하고 나머지 리포트는 계속 만든다(computeSensitivityAnalysis와 같은 관례).
  test('몬테카를로 결과가 없으면 빈 문자열을 반환한다', () => {
    expect(renderMonteCarloSection(undefined, sequenceRisk)).toBe('');
  });

  test('성공률과 시행 횟수를 표기한다', () => {
    const html = renderMonteCarloSection(monteCarlo, sequenceRisk);

    expect(html).toContain('87%');
    expect(html).toContain('1,000');
    expect(html).toContain('90세');
  });

  test('변동성·분포·상관·시드 가정을 표기한다', () => {
    const html = renderMonteCarloSection(monteCarlo, sequenceRisk);

    expect(html).toContain('연 변동성 18%p');
    expect(html).toContain('정규분포');
    expect(html).toContain('같은 시장 충격');
    expect(html).toContain('고정 시드 1');
  });

  test('잔여자산 분위수를 표로 싣는다', () => {
    const html = renderMonteCarloSection(monteCarlo, sequenceRisk);

    expect(html).toContain('하위 10%');
    expect(html).toContain('중앙값');
    expect(html).toContain('상위 10%');
  });

  // 변동성 손실은 화면과 PDF 모두에서 드러나야 한다.
  test('변동 없음 가정과 나란히 놓아 변동성 손실을 드러낸다', () => {
    expect(renderMonteCarloSection(monteCarlo, sequenceRisk)).toContain('변동 없음');
  });

  test('순서 리스크가 있으면 경우별 비교를 싣는다', () => {
    const html = renderMonteCarloSection(monteCarlo, sequenceRisk);

    expect(html).toContain('나쁜 해가 먼저');
    expect(html).toContain('연평균');
  });

  test('순서 리스크가 없어도 몬테카를로 부분은 렌더한다', () => {
    const html = renderMonteCarloSection(monteCarlo, undefined);

    expect(html).toContain('87%');
    expect(html).not.toContain('나쁜 해가 먼저');
  });
});

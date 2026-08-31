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
  renderGoalConflictSection,
  renderSustainableSpendingLimitSection,
} from '@/web/features/Pdf/pdfReportSections';
import { formatManwon } from '@/core/usecases/utility/utilityAnalysis';
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
    expect(html).toContain('목표생활비 완전 충족률');
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
import { resolveSpendingCurve } from '@/core/usecases/spending/spendingCurve';
import { CandidateRecommendation, PRIMARY_SELECTION_NOTE, ValidatedStrategyCandidate } from '@/core/recommendation/RecommendationEngine';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { NO_GOAL_FAILURE, LEGACY_GOAL_CONDITIONS } from '@/tests/fixtures/goalFailure';
import { describeUnscoredGoals } from '@/core/usecases/goals/goalScoreSupport';
import { initialParams } from '@/infrastructure/storage/localStore';
import { resolveGoalSuccessConditions } from '@/core/usecases/goals/goalSuccessConditions';
import reportCapture from '@/tests/fixtures/pdfReport/reportCapture.json';

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

  const stable: CandidateRecommendation = {
    persona: 'STABLE', label: '안정형', candidate: candidate(2, 0.70),
    reason: '목표 달성 확률을 가장 우선했습니다.',
  };

  test('페르소나 카드와 달라지는 점을 싣는다', () => {
    const html = renderStrategyRecommendationSection({
      recommendations: [balanced], status: 'done', params, formatValue,
    });

    expect(html).toContain('균형형');
    expect(html).toContain('94%');
    expect(html).toContain('현재 계획에서 달라지는 점');
  });

  // 화면 카드와 같은 함수(describeStrategyOutcomeChanges)를 써야 한다. 리포트가 따로
  // 계산하면 같은 계획의 두 문서가 다른 금액을 말한다.
  test('현상 유지 요약이 있으면 「적용하면 달라지는 수치」를 함께 싣는다', () => {
    const withOutcome: CandidateRecommendation = {
      ...balanced,
      candidate: {
        ...balanced.candidate,
        outcome: {
          averageAnnualWithdrawal: 20_000_000,
          averageAnnualTaxAndLevy: 4_000_000,
          nationalPensionFirstAge: 60,
          nationalPensionMonthlyNet: 1_350_000,
        },
      },
    };

    const html = renderStrategyRecommendationSection({
      recommendations: [withOutcome], status: 'done', params, formatValue,
      baselineOutcome: {
        averageAnnualWithdrawal: 30_000_000,
        averageAnnualTaxAndLevy: 2_000_000,
        nationalPensionFirstAge: 65,
        nationalPensionMonthlyNet: 1_900_000,
      },
    });

    expect(html).toContain('적용하면 달라지는 수치');
    expect(html).toContain('국민연금 실수령액(세후)');
    expect(html).toContain('65세부터 월 190만원');
    expect(html).toContain('60세부터 월 135만원');
    expect(html).toContain('은퇴 후 연평균 세금·건강보험료');
  });

  test('현상 유지 요약이 없으면 그 표를 만들지 않는다', () => {
    const html = renderStrategyRecommendationSection({
      recommendations: [balanced], status: 'done', params, formatValue,
    });

    expect(html).not.toContain('적용하면 달라지는 수치');
  });

  // ☆추천 선정 규칙은 selectPrimary 한 곳에만 있어야 한다. 예전에 이 파일이
  // `find(persona === 'BALANCED')`로 직접 골랐는데, 그 규칙은 「목표를 지킨 최고 확률 카드」로
  // 바뀌면서 화면에서 삭제됐다. 규칙이 두 벌이면 같은 계획을 두고 화면은 안정형에,
  // 리포트는 균형형에 별을 붙인다 — 리포트는 화면보다 오래 남고 그대로 인용된다.
  describe('☆추천 배지', () => {
    const star = '&#9733; 추천';

    test('엔진이 고른 카드에만 붙는다 — 균형형이 아니어도 마찬가지다', () => {
      const html = renderStrategyRecommendationSection({
        recommendations: [balanced, stable], primary: stable,
        status: 'done', params, formatValue,
      });

      const balancedIndex = html.indexOf('균형형');
      const stableIndex = html.indexOf('안정형');
      const starIndex = html.indexOf(star);
      expect(starIndex).toBeGreaterThan(stableIndex);
      expect(balancedIndex).toBeLessThan(stableIndex);
      // 별은 하나뿐이고, 그것이 안정형 쪽이다.
      expect(html.split(star)).toHaveLength(2);
      // 근거도 함께 인쇄한다. 규칙이 「확률 최고」가 아니므로, 밝히지 않으면 확률이 더 높은
      // 카드가 옆에 있을 때 배지가 오류로 읽힌다.
      expect(html).toContain(PRIMARY_SELECTION_NOTE);
    });

    // 첫 카드로 폴백하면 엔진이 고르지 않은 카드가 「추천」으로 인쇄된다.
    test('엔진이 고르지 않았으면 어떤 카드에도 붙이지 않는다', () => {
      const html = renderStrategyRecommendationSection({
        recommendations: [balanced, stable], primary: null,
        status: 'done', params, formatValue,
      });

      expect(html).not.toContain(star);
      expect(html).not.toContain(PRIMARY_SELECTION_NOTE);
    });
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
    // **그 금액이 어느 세계의 값인지 밝힌다.** 결정론 이진탐색의 한계값이라 리포트 앞장의
    // 목표 달성 확률과 아무 관계가 없다. 화면과 «같은 문장»이어야 한다.
    expect(html).toContain('현재 수익률과 연금, 물가, 기대수명 가정이 그대로 유지될 경우');
    expect(html).toContain('권장 생활비를 의미하지 않습니다');
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
    // 금액이 없으면 그 금액을 설명하는 문장도 서지 않는다.
    expect(html).not.toContain('권장 생활비를 의미하지 않습니다');
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
      { key: 'yieldConservative', label: '안정형 가정 (주식 5%)', depletionAge: 82, deltaYears: -6,
        endingAssets: 0, endingAssetsDelta: -2500000000, unmetSpendingYears: 8 },
      { key: 'yieldAggressive', label: '공격형 가정 (주식 9%)', depletionAge: null, deltaYears: 4,
        endingAssets: 5000000000, endingAssetsDelta: 2500000000, unmetSpendingYears: 0 },
    ];
    const html = renderSensitivityTableSection(scenarios);
    expect(html).toContain('안정형 가정 (주식 5%)');
    expect(html).toContain('82세');
    expect(html).toContain('공격형 가정 (주식 9%)');
    expect(html).toContain('평생 유지');
  });

  // 고갈이 전혀 없는 계획에서 예전 표는 6행이 모두 "평생 유지" 한 단어뿐이라 아무 정보도
  // 주지 못했다. 기말자산 열이 그 구분을 만든다.
  test('고갈이 없어도 기말자산과 증감으로 시나리오가 구분된다', () => {
    const scenarios: SensitivityScenario[] = [
      { key: 'yieldConservative', label: '안정형 가정 (주식 5%)', depletionAge: null, deltaYears: null,
        endingAssets: 820000000, endingAssetsDelta: -1680000000, unmetSpendingYears: 0 },
      { key: 'yieldAggressive', label: '공격형 가정 (주식 9%)', depletionAge: null, deltaYears: null,
        endingAssets: 5100000000, endingAssetsDelta: 2600000000, unmetSpendingYears: 0 },
    ];
    const html = renderSensitivityTableSection(scenarios);

    expect(html).toContain('8억 2,000만원');
    expect(html).toContain('51억원');
    expect(html).toContain('-16억 8,000만원');
    expect(html).toContain('+26억원');
  });

  // **수익률 3행은 사용자 가정 대비 ±가 아니라 5/7/9%라는 절대 앵커다.** 사용자 가정이
  // 그보다 높으면 세 행이 전부 기준선 아래로 내려가는 것이 정상인데, 그 사실은 사용자
  // 자신의 수익률을 함께 보여주지 않으면 표에서 «보이지 않는다». 화면과 같은 문장이다.
  test('사용자 자신의 가중평균 총수익률과 기준선 행을 함께 싣는다', () => {
    const scenarios: SensitivityScenario[] = [
      { key: 'yieldAggressive', label: '공격형 가정 (주식 9%)', depletionAge: null, deltaYears: null,
        endingAssets: 286400000, endingAssetsDelta: -1172010000, unmetSpendingYears: 0 },
    ];
    const html = renderSensitivityTableSection(scenarios, {
      depletionAge: null, unmetSpendingYears: 0, planAssetStatus: 'sustained',
      weightedTotalReturn: 12.34, endingAssets: 1458410000,
    });

    expect(html).toContain('가중평균 총수익률 12.3%');
    expect(html).toContain('사적연금 포함');
    expect(html).toContain('주식·ISA를 5/7/9%, 사적연금을 3/4/6%로 통째로 바꾼 결과');
    expect(html).toContain('현재 가정과 무관하게 고정된 비교 기준');
    expect(html).toContain('현재 가정 (기준)');
    expect(html).toContain('14억 5,841만원');
    // 기준선 행은 표의 «맨 위»다 — 비교 대상이 아니라 비교의 기준이다.
    expect(html.indexOf('현재 가정 (기준)')).toBeLessThan(html.indexOf('공격형 가정'));
  });

  // 굴릴 잔액이 없으면 가중평균을 낼 수 없다. 없는 값을 0%라고 말하지 않는다.
  test('유도할 잔액이 없으면 수익률 문장을 만들지 않는다', () => {
    const scenarios: SensitivityScenario[] = [
      { key: 'yieldAggressive', label: '공격형 가정 (주식 9%)', depletionAge: null, deltaYears: null,
        endingAssets: 0, endingAssetsDelta: 0, unmetSpendingYears: 0 },
    ];
    const html = renderSensitivityTableSection(scenarios, {
      depletionAge: null, unmetSpendingYears: 0, planAssetStatus: 'sustained', weightedTotalReturn: null,
    });

    expect(html).not.toContain('가중평균 총수익률');
  });

  // 화면(SensitivityAnalysisSection)과 같은 규칙이어야 한다 — 두 문서가 서로 다른 표를
  // 보여주면 안 된다.
  test('투자자산이 없으면 결과가 baseline과 동일한 행을 접고 몇 개를 접었는지 밝힌다', () => {
    const scenarios: SensitivityScenario[] = [
      { key: 'yieldConservative', label: '안정형 가정 (주식 5%)', depletionAge: 51, deltaYears: 0,
        endingAssets: 0, endingAssetsDelta: 0, unmetSpendingYears: 31 },
      { key: 'yieldAggressive', label: '공격형 가정 (주식 9%)', depletionAge: 51, deltaYears: 0,
        endingAssets: 0, endingAssetsDelta: 0, unmetSpendingYears: 31 },
      { key: 'retirementLater', label: '은퇴시점 +3년', depletionAge: 51, deltaYears: 0,
        endingAssets: 0, endingAssetsDelta: 0, unmetSpendingYears: 28 },
    ];

    const html = renderSensitivityTableSection(scenarios, {
      depletionAge: 51,
      unmetSpendingYears: 31,
      planAssetStatus: 'no_investable_asset',
    });

    expect(html).not.toContain('안정형 가정 (주식 5%)');
    expect(html).not.toContain('공격형 가정 (주식 9%)');
    expect(html).toContain('은퇴시점 +3년');
    expect(html).toContain('투자자산이 없어');
    expect(html).toContain('2개 가정은 생략');
  });

  test('투자자산이 있으면 baseline 정보를 넘겨도 행을 접지 않는다', () => {
    const scenarios: SensitivityScenario[] = [
      { key: 'yieldConservative', label: '안정형 가정 (주식 5%)', depletionAge: null, deltaYears: null,
        endingAssets: 820000000, endingAssetsDelta: -1680000000, unmetSpendingYears: 0 },
    ];

    const html = renderSensitivityTableSection(scenarios, {
      depletionAge: null,
      unmetSpendingYears: 0,
      planAssetStatus: 'sustained',
    });

    expect(html).toContain('안정형 가정 (주식 5%)');
    expect(html).not.toContain('생략');
  });

  test('생활비를 채우지 못한 해가 있으면 표에 함께 적는다', () => {
    const scenarios: SensitivityScenario[] = [
      { key: 'yieldConservative', label: '안정형 가정 (주식 5%)', depletionAge: null, deltaYears: null,
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
    endingAssets: { p10, p50, p90: 977090000 },
    assetBands: [], depletion: { count: 630, earliestAge: 72, medianAge: 84 },
    deterministicEndingAssets: 0,
  });
  const render = (successRate?: number, monteCarlo?: MonteCarloResult, params: SimulationParams = initialParams) =>
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
      params,
      formatValue: won,
    });
  // resolveSimulationVerdict.test.ts와 같은 픽스처 형태. RetirementGoal에는 id 필드가 없다
  // (retirementGoal.ts 확인 — type·priority·targetValue?·targetValueSource?·constraintType뿐).
  const goalParams = (goals: unknown[]): SimulationParams => ({
    ...initialParams,
    retirementGoals: goals as SimulationParams['retirementGoals'],
  });

  // 리포트는 화면보다 오래 남고 그대로 인용된다. 「점수 산정 대상이 아니다」를 화면만 말하면
  // 인쇄본을 든 사용자는 그 목표의 0점을 여전히 실패로 읽는다. 문장의 출처는 core 한 곳이며
  // (describeUnscoredGoals) 화면과 «같은 문장»이어야 한다(PRD 9.3).
  test('점수 산정 대상이 아닌 목표를 화면과 같은 문장으로 인쇄한다', () => {
    const html = render(0.9, {
      ...mc(0.9),
      goalConditions: {
        basis: 'selected_goals',
        requireSpendingTarget: true,
        requireAssetSurvival: false,
        terminalAssetGoal: 0,
        unmeasuredGoals: ['TAX_OPTIMIZATION', 'HOUSING_STABILITY'],
        // 이 테스트는 점수 산정 대상 안내 문구만 검증한다. HARD 강도는 무관하므로 전부 false.
        hardRequirements: { spendingTarget: false, assetSurvival: false, terminalAsset: false },
      },
    });

    expect(html).toContain('반영되지 않은 목표: 세금 최소화, 주거 안정');
    expect(html).toContain(describeUnscoredGoals(['HOUSING_STABILITY']));
    expect(html).toContain('0점은 목표 실패가 아니라');
  });

  test('점수 산식이 있는 목표만 미반영이면 점수 안내를 붙이지 않는다', () => {
    const html = render(0.9, {
      ...mc(0.9),
      goalConditions: {
        basis: 'selected_goals',
        requireSpendingTarget: true,
        requireAssetSurvival: false,
        terminalAssetGoal: 0,
        unmeasuredGoals: ['TAX_OPTIMIZATION'],
        // 점수 안내 문구가 붙지 않음을 확인하는 테스트라 HARD 강도는 무관하다. 전부 false.
        hardRequirements: { spendingTarget: false, assetSurvival: false, terminalAsset: false },
      },
    });

    expect(html).not.toContain('점수 산정 대상이 아닙니다');
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
    expect(html).toContain('1,000회 중 370회가 판정 조건 충족');
    expect(html).toContain('실제 미래 결과를 보장하지 않습니다');
  });

  // 화면과 PDF가 같은 대표값을 말해야 한다. 전체 분위수 표는 뒤 섹션이 소유하지만, 화면
  // 진단 카드의 대표값인 p50은 첫 페이지에도 같은 라벨로 싣는다.
  test('화면과 같은 잔여자산 중앙값을 대표값으로 먼저 싣는다', () => {
    const html = render(0.37, mc(0.37, 100000000, 5000000));

    expect(html).not.toContain('생활 유지 37%');
    expect(html).not.toContain('자산 보존 37%');
    expect(html).toContain('90세 예상자산(중앙값) 100,000,000원');
    expect(html.indexOf('90세 예상자산(중앙값)')).toBeLessThan(html.indexOf('90세 예상자산(기준 수익률)'));
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
  //
  // **폴백이 되살아나면 여기서 잡힌다.** 옛 네 단계 폴백(simulationSuccessRate ??
  // goalSuccessProbability ?? confidence.rates?.goalSuccessProbability ??
  // confidence.rates?.spendingSuccessRate ?? 0)의 마지막 단계는 monteCarlo가 없어도
  // "목표 달성 확률 0%"를 찍었다 — "판정 못 함"과 "전멸"이 같은 숫자였다.
  // resolveSimulationVerdict는 이 경로에서 goalSuccess.rate에 NaN을 채우므로, 가드 없이
  // 그대로 포맷했다면 "NaN%"가 찍혔을 것이다. 이 테스트는 둘 다 잡는다.
  test('MC가 없으면 생략하지 않고 계산되지 않았다고 밝힌다', () => {
    const html = render(undefined, undefined);

    expect(html).toContain('시장 변동성 반영');
    expect(html).toContain('아직 계산되지 않았습니다');
    expect(html).toContain('확률 판정 보류');
    expect(html).toContain('시장 변동성 미반영');
    expect(html).not.toContain('유지 확률');
    expect(html).not.toContain('목표 달성 확률 0%');
    expect(html).not.toContain('NaN');
  });

  // known-issues #1: 주거 안정을 HARD로 고정해도 계산은 정확했지만, 화면이 그 조건이
  // 지켜진 것처럼 보여준 결함이었다. HARD 성공률이 판정하지 못한 목표(주거 안정)를 섞은 채
  // 비율만 인쇄하면 같은 결함을 지표 하나로 반복한다 — 그래서 비율 옆에 반드시 그 사실이
  // 함께 인쇄돼야 한다.
  test('판정하지 못한 HARD 목표가 있으면 비율 옆에 그 사실을 밝힌다', () => {
    const params = goalParams([
      { type: 'ASSET_SURVIVAL', constraintType: 'HARD', priority: 1 },
      { type: 'HOUSING_STABILITY', constraintType: 'HARD', priority: 2 },
    ]);
    const html = render(0.9, {
      ...mc(0.9),
      hardGoalSuccessProbability: 0.5,
      goalConditions: {
        ...LEGACY_GOAL_CONDITIONS,
        hardRequirements: { spendingTarget: false, assetSurvival: true, terminalAsset: false },
      },
    }, params);

    expect(html).toMatch(/HARD 목표 .*중 .*기준|판정하지 않/);
    expect(html).toContain('HARD 목표 판정 확률 50%');
    expect(html).toContain('주거 안정');
  });

  // 확정 HARD 목표가 없으면(요구 조건 자체가 없으면) 이 절이 전혀 인쇄되지 않는다 — 요구가
  // 없는데 100%로 찍히면 "HARD 목표를 다 지켰다"로 오해를 부른다
  // (resolveSimulationVerdict.ts 주석 참고).
  test('확정 HARD 목표가 없으면 HARD 판정 절을 인쇄하지 않는다', () => {
    const html = render(0.9, mc(0.9));

    expect(html).not.toContain('HARD 목표 판정 확률');
  });

  // **골든의 사각지대를 메운다.** buildReportHtml.test.ts는 앱에서 미리 캡처해 둔 완성
  // HTML 문자열(source.sections)을 그대로 조립만 하고, renderPlanVerdictSection을 실제로
  // 호출한 적이 없다 — 그 골든의 "목표 달성 확률 82%"가 그대로 남아 있는 것은 이 함수가
  // 옳은 값을 냈다는 증거가 아니라, 캡처된 문자열을 한 글자도 안 건드렸다는 증거일 뿐이다
  // (리뷰 지적). 이 테스트는 같은 시나리오를 이 함수에 «직접» 통과시켜 같은 숫자가 나오는지
  // 확인한다 — 실패하면 셀렉터 배선이 실제로 값을 바꿨다는 뜻이다.
  //
  // reportCapture.json은 params·result(SimulationResult)와 «완성된 HTML»만 담았고, 캡처
  // 당시 값을 만든 원본 MonteCarloResult·PlanConfidence는 저장되지 않았다(임시 훅으로 한
  // 번 뜬 값이라 저장 대상이 아니었다 — capture.params/result는 있고 capture.monteCarlo는
  // 없다). 그래서 두 입력은 캡처된 «렌더 결과»에서 역산해 재구성한다:
  //   - sections.monteCarlo의 "생활 유지 성공률 82%"·"자산 보존 성공률 92%"·"1,000회
  //     시뮬레이션"·"고정 시드 20260101" → spendingSuccessRate 0.82, successRate 0.92,
  //     trials 1000, seed 20260101.
  //   - result.retirementScore(95)와 sections.planVerdict의 "은퇴 준비도 86점 (안정) ·
  //     기준 시나리오만 보면 95점"·"대체로 안정적입니다" → computePlanConfidence(95, {...})가
  //     이 세 문구를 모두 재현하는 rates 조합은 goalSuccessProbability 0.82뿐이다(대역폭
  //     확인: round(95*(0.5+0.5*0.82))=86, getPlanConfidenceBand(0.82)='stable').
  // goalConditions만은 손으로 짓지 않는다 — 실제 캡처된 params로 프로덕션이 쓰는 바로 그
  // 함수(resolveGoalSuccessConditions, MonteCarloEngine.ts:171과 같은 호출)를 불러 만든다.
  // 조건을 테스트가 따로 지어내면 셀렉터가 실제로 근거로 삼는 조건과 다른 것을 검증하게
  // 된다. 캡처된 params의 목표는 LIVING_EXPENSE_STABILITY(SOFT)·ASSET_SURVIVAL(HARD)이고,
  // hardGoalSuccessProbability는 캡처 당시(이 필드가 아직 없던 구버전) 존재하지 않았으므로
  // 여기서도 넣지 않는다 — resolveSimulationVerdict가 undefined를 '계산 안 함'으로 읽어
  // hardGoalSuccess를 null로 떨어뜨리고, 그래서 원본 캡처처럼 HARD 판정 절이 나오지 않는다.
  test('캡처된 리포트 시나리오를 다시 넣으면 골든과 같은 82%를 낸다', () => {
    const fixtureParams = reportCapture.params as unknown as SimulationParams;
    const goalConditions = resolveGoalSuccessConditions(fixtureParams);

    const monteCarlo: MonteCarloResult = {
      trials: 1000, seed: 20260101, successAge: fixtureParams.userProfile.expectancy,
      successRate: 0.92, spendingSuccessRate: 0.82, goalSuccessProbability: 0.82,
      goalFailure: NO_GOAL_FAILURE,
      goalConditions,
      plannedMonthlySpending: fixtureParams.userProfile.targetMonthlySpending,
      endingAssets: { p10: 0, p50: reportCapture.result.endingAssets, p90: 0 },
      assetBands: [], depletion: { count: 0, earliestAge: null, medianAge: null },
      deterministicEndingAssets: reportCapture.result.endingAssets,
    };

    const html = renderPlanVerdictSection({
      expectancy: fixtureParams.userProfile.expectancy,
      deterministicDepletionText: `기대수명(${fixtureParams.userProfile.expectancy}세)까지 고갈 없음`,
      endingAssets: reportCapture.result.endingAssets,
      confidence: computePlanConfidence(reportCapture.result.retirementScore, {
        spendingSuccessRate: 0.82, assetSuccessRate: 0.92, goalSuccessProbability: 0.82,
      }),
      monteCarlo,
      params: fixtureParams,
      formatValue: won,
    });

    // 골든(reportCapture.json → sections.planVerdict)이 담고 있는 바로 그 문장들.
    expect(html).toContain('목표 달성 확률 82%');
    expect(html).toContain('대체로 안정적입니다');
    expect(html).toContain('은퇴 준비도 86점');
    expect(html).toContain('기준 시나리오만 보면 95점');
    // 캡처 당시 존재하지 않던 필드라 이 절이 나오면 안 된다 — hardGoalSuccessProbability를
    // undefined로 남긴 재구성이 실제로 hardGoalSuccess를 null로 떨어뜨렸는지 함께 확인한다.
    expect(html).not.toContain('HARD 목표 판정 확률');
  });
});

describe('renderMonteCarloSection', () => {
  // 실패 원인 문장이 지목할 «설정»의 출처. 여기서는 인출을 막는 설정이 없는 계획이다.
  const mcParams: SimulationParams = {
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 1_000_000 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };
  const monteCarlo: MonteCarloResult = {
    trials: 1000, seed: 1, annualStdDev: 18, successAge: 90, successRate: 0.87, spendingSuccessRate: 0.81,
    goalSuccessProbability: 0.81,
    goalFailure: NO_GOAL_FAILURE, goalConditions: LEGACY_GOAL_CONDITIONS,
    plannedMonthlySpending: 3000000,
    endingAssets: { p10: 200000000, p50: 1800000000, p90: 5200000000 },
    assetBands: [
      { age: 60, p10: 400000000, p50: 1200000000 },
      { age: 70, p10: 350000000, p50: 1050000000 },
      { age: 90, p10: 200000000, p50: 600000000 },
    ],
    depletion: { count: 130, earliestAge: 79, medianAge: 86 },
    deterministicEndingAssets: 2500000000,
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
    expect(renderMonteCarloSection(undefined, sequenceRisk, mcParams)).toBe('');
  });

  test('성공률과 시행 횟수를 표기한다', () => {
    const html = renderMonteCarloSection(monteCarlo, sequenceRisk, mcParams);

    expect(html).toContain('87%');
    expect(html).toContain('1,000');
    expect(html).toContain('90세');
  });

  // **화면과 같은 문장이어야 한다.** 판정 기준(연령대별 목표 생활비)은 엔진의 것이므로
  // describeSuccessRates가 만들고 두 문서가 그것을 그대로 인쇄한다. 예전에는 두 곳이 각자
  // 「계획 생활비(월 300만원)를 한 해도 줄이지 않은 경우입니다」를 적고 있었고, 곡선을 켠
  // 계획에서 두 곳이 «동시에» 판정 기준과 다른 금액을 말했다.
  test('생활 유지 성공률의 기준을 연령대별 목표 생활비로 밝힌다', () => {
    const html = renderMonteCarloSection(
      monteCarlo,
      sequenceRisk,
      { ...mcParams, spendingCurve: resolveSpendingCurve('front_loaded') },
    );

    expect(html).toContain('연령별 목표 생활비');
    expect(html).toContain('60~69세 300만원');
    expect(html).toContain('70~79세 258만원');
    expect(html).toContain('80~90세 228만원');
    expect(html).not.toContain('계획 생활비(월 300만원)를 한 해도 줄이지 않은');
  });

  // 관계 문장은 두 비율보다 «앞»에 온다 — 문장 자체가 「아래 두 비율」이라고 가리킨다.
  test('목표 달성 확률과 두 비율의 관계를 두 비율보다 먼저 밝힌다', () => {
    const html = renderMonteCarloSection(monteCarlo, sequenceRisk, mcParams);

    expect(html).toContain('같은 시행에서');
    expect(html).toContain('곱하거나 더한 값이 아닙니다');
    expect(html.indexOf('곱하거나 더한 값이 아닙니다')).toBeLessThan(html.indexOf('목표생활비 완전 충족률'));
    // 두 비율이 판정 술어와 «같다»고 주장하던 옛 문구는 남기지 않는다(AUDIT-003).
    expect(html).not.toContain('그 확률을 이루는 두 성분');
  });

  test('변동성·분포·상관·시드 가정을 표기한다', () => {
    const html = renderMonteCarloSection(monteCarlo, sequenceRisk, mcParams);

    expect(html).toContain('연 변동성 18%p');
    expect(html).toContain('정규분포');
    expect(html).toContain('계좌별 충격은 기대수익률에 비례');
    expect(html).toContain('고정 시드 1');
  });

  test('잔여자산 분위수를 표로 싣는다', () => {
    const html = renderMonteCarloSection(monteCarlo, sequenceRisk, mcParams);

    expect(html).toContain('하위 10%');
    expect(html).toContain('중앙값');
    expect(html).toContain('상위 10%');
  });

  // **변동성 손실은 화면과 PDF가 같은 기준으로 드러낸다.**
  //
  // 예전에는 중앙값이 표 안에, 결정론 값이 표 «아래» 각주에 떨어져 있어 둘을 눈으로
  // 이어 붙여야 격차가 보였다. 같은 표의 중앙값 열에 나란히 놓으면 위아래로 바로 읽힌다.
  // 화면(MonteCarloSection의 volatility-drag)이 두 값을 붙여 놓는 것과 같은 기준이다.
  test('변동 없음 가정을 분포와 같은 표에 실어 변동성 손실을 드러낸다', () => {
    const html = renderMonteCarloSection(monteCarlo, sequenceRisk, mcParams);

    expect(html).toContain('변동 없음 가정');
    // 결정론 25억이 표의 «행»으로 들어가야 한다 — 표 밖 각주가 아니라.
    const tableEnd = html.indexOf('</table>');
    expect(html.slice(0, tableEnd)).toContain(formatManwon(2_500_000_000));
    // 중앙값 18억은 같은 표에 그대로 남는다.
    expect(html.slice(0, tableEnd)).toContain(formatManwon(1_800_000_000));
  });

  // 화면과 리포트가 같은 시행을 다르게 설명하면 사용자는 어느 조치를 해야 할지 알 수 없다.
  // 예전에는 PDF에 원인 문장이 아예 없어, 화면은 「목표 생활비를 채우지 못합니다」, 리포트는
  // 「자산이 먼저 바닥났다」만 적었다.
  test('목표를 달성하지 못한 원인을 화면과 같은 문장으로 싣는다', () => {
    const html = renderMonteCarloSection({
      ...monteCarlo,
      // 「자산 고갈 방지」를 고르지 않아 판정값은 0이지만 실제로는 420회 고갈된 계획.
      goalFailure: {
        spendingShortfall: 420, assetDepletion: 0, observedAssetDepletionCount: 420,
        observedEarliestDepletionAge: 62,
        terminalShortfall: 0, medianFirstShortfallAge: 73, terminalAssetGoal: 0,
      },
    }, sequenceRisk, mcParams);

    expect(html).toContain('목표를 달성하지 못한 시행의 원인');
    expect(html).toContain('1,000회 중 420회에서 기대수명 전에 자산이 고갈됩니다.');
    expect(html).not.toContain('목표 생활비를 채우지 못합니다');
  });

  // 확률이 100%인데도 할 말이 남는 유일한 경우다. 원인 블록을 cause !== 'none'으로 잘라
  // 두면 이 문장이 리포트에 한 번도 실리지 않는다 — 바로 위 「자산이 먼저 바닥난 경우가
  // N회…」만 남아, 그 고갈이 왜 확률에 없는지는 끝내 설명되지 않는다.
  test('목표를 다 달성했어도 자산이 실제로 고갈됐으면 그 사실을 싣는다', () => {
    const html = renderMonteCarloSection({
      ...monteCarlo,
      goalFailure: {
        spendingShortfall: 0, assetDepletion: 0, observedAssetDepletionCount: 420,
        observedEarliestDepletionAge: 62,
        terminalShortfall: 0, medianFirstShortfallAge: null, terminalAssetGoal: 0,
      },
    }, sequenceRisk, mcParams);

    expect(html).toContain('확률에 반영되지 않은 사실');
    expect(html).toContain('고른 목표는 1,000회 모두 달성했습니다.');
    expect(html).toContain('420회(가장 이른 62세)');
    // 목표를 놓친 시행이 한 번도 없으므로 실패 원인 제목을 붙이면 바로 아래 문장을 부정한다.
    expect(html).not.toContain('목표를 달성하지 못한 시행의 원인');
  });

  // 게이트를 넓히면서 «아무 일도 없는» 계획에까지 문장이 새로 생기면 소음을 더한 것이다.
  test('목표 실패 시행도 관측 고갈도 없으면 원인 문장을 싣지 않는다', () => {
    const html = renderMonteCarloSection(monteCarlo, sequenceRisk, mcParams);

    expect(html).not.toContain('목표를 달성하지 못한 시행의 원인');
    expect(html).not.toContain('확률에 반영되지 않은 사실');
    expect(html).not.toContain('모든 시행에서 목표 조건을 만족했습니다');
  });

  test('순서 리스크가 있으면 경우별 비교를 싣는다', () => {
    const html = renderMonteCarloSection(monteCarlo, sequenceRisk, mcParams);

    expect(html).toContain('나쁜 해가 먼저');
    expect(html).toContain('같은 수익률 집합');
  });

  test('순서 리스크가 없어도 몬테카를로 부분은 렌더한다', () => {
    const html = renderMonteCarloSection(monteCarlo, undefined, mcParams);

    expect(html).toContain('87%');
    expect(html).not.toContain('나쁜 해가 먼저');
  });
});

// 리포트는 화면보다 오래 남고 그대로 인용된다. 충돌을 여기서 빠뜨리면 「목표가 서로 맞았다」로
// 읽히므로, 화면과 «같은 문장»이 실려야 한다.
describe('renderGoalConflictSection', () => {
  const conflicted = {
    goalConflict: true,
    conflictingGoals: [
      {
        goalType: 'LIVING_EXPENSE_STABILITY' as const,
        constraintLayer: 1 as const,
        shortfall: { unit: 'MONTHLY_MONEY' as const, amount: 120_000 },
      },
      {
        goalType: 'INHERITANCE' as const,
        constraintLayer: 2 as const,
        shortfall: { unit: 'MONEY' as const, amount: 84_000_000 },
      },
    ],
    yieldedGoal: 'INHERITANCE' as const,
  };

  test('화면과 같은 문장을 싣는다', () => {
    const html = renderGoalConflictSection(conflicted);

    expect(html).toContain('동시에 달성하기 어려운 목표가 있습니다');
    // 「지켰다」가 아니라 「우선했다」다 — 이긴 쪽도 미달일 수 있어 「지켰다」는 거짓이 된다.
    expect(html).toContain(
      '「반드시 지키기」로 설정한 생활비를 상속 자산 확보 목표보다 우선했습니다.'
      + ' 그래도 두 목표를 모두 충족하기에는 자산이 부족합니다.'
    );
    // 이긴 쪽 미달을 빼면 「양보해서 지켜냈다」로 읽힌다. 양쪽이 함께 와야 한다.
    expect(html).toContain('생활비 안정 월 12만원 부족');
    expect(html).toContain('상속 자산 확보 8,400만원 부족');
  });

  test('충돌이 없으면 빈 문자열이다', () => {
    // 빈 껍데기도, 「충돌 없음」 문구도 두지 않는다 — 없는 것은 말하지 않는다.
    expect(renderGoalConflictSection({ goalConflict: false, conflictingGoals: [] })).toBe('');
  });
});

// 리포트는 화면보다 오래 남아 그대로 인용된다. 「이 금액은 권장액이 아니다」가 화면에만 있고
// 리포트에 없으면, 인용되는 쪽이 3.35억을 남기던 계획과 같은 얼굴로 0원 계획을 인쇄한다.
describe('renderSustainableSpendingLimitSection', () => {
  const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`;
  const override = {
    preferenceRespectingMonthly: 1_181_250,
    floorHonoringMonthly: 3_446_597,
    deliveredMonthly: 3_446_597,
    hardSpendingFloor: 2_500_000,
  };

  test('화면과 «같은 문장»을 찍는다', () => {
    const html = renderSustainableSpendingLimitSection({
      override, endingAssets: 5, depletionAge: null, expectancy: 70, formatValue: won,
    });

    expect(html).toContain('「반드시 지키기」로 정한 생활비를 우선한 한계 계획입니다');
    expect(html).toContain(
      '설정한 생활비를 반드시 충족하도록 인출한 결과, 지속 가능한 생활비가 '
      + '월 1,181,250원에서 월 3,446,597원으로 올랐습니다. '
      + '「반드시 지키기」로 정한 월 2,500,000원이 세제 최적화·계좌 인출 순서·월 인출 목표보다 '
      + '우선하기 때문입니다.'
    );
    expect(html).toContain('이 금액은 권장 생활비가 아니라 자산을 거의 소진하는 한계 수준입니다.');
    expect(html).toContain(
      '기대수명 70세 시점 잔여자산은 5원입니다. 예상치 못한 지출이나 상속에 쓸 여유가 남지 않습니다.'
    );
    // 이 계획의 바닥은 한계의 72.5%라 위험 경고는 «없다».
    expect(html).not.toContain('거의 닿아 있습니다');
    expect(html).not.toContain('버티지 못합니다');
  });

  test('바닥이 한계를 넘으면 고갈 위험 경고가 함께 인쇄된다', () => {
    const html = renderSustainableSpendingLimitSection({
      override: { ...override, hardSpendingFloor: 5_000_000, deliveredMonthly: 5_000_000 },
      endingAssets: 0, depletionAge: 67, expectancy: 70, formatValue: won,
    });

    expect(html).toContain(
      '자산이 67세에 바닥나 기대수명 70세까지 버티지 못합니다. '
      + '「반드시 지키기」로 정한 월 5,000,000원이 이 계획이 감당하는 한계(월 3,446,597원)를 '
      + '넘기 때문입니다.'
    );
  });

  test('잔여자산이 남으면 그 경고만 빠진다', () => {
    const html = renderSustainableSpendingLimitSection({
      override, endingAssets: 500_000_000, depletionAge: null, expectancy: 70, formatValue: won,
    });

    expect(html).toContain('이 금액은 권장 생활비가 아니라 자산을 거의 소진하는 한계 수준입니다.');
    expect(html).not.toContain('시점 잔여자산은');
  });

  test('바닥이 구속하지 않은 계획에는 빈 문자열이다', () => {
    // 빈 <div>를 남기면 리포트에 이유 없는 테두리가 하나 생긴다.
    expect(renderSustainableSpendingLimitSection({
      override: undefined, endingAssets: 5, depletionAge: null, expectancy: 70, formatValue: won,
    })).toBe('');
  });
});

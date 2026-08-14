import { describe, test, expect } from 'vitest';
import {
  formatCurrencyUnit,
  renderRiskAlertsSection,
  renderItemizedChecklistSection,
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
import { StrategyRecommendation, UtilityBreakdown } from '@/core/entities/types';

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

describe('renderItemizedChecklistSection', () => {
  const utility: UtilityBreakdown = {
    score: 76,
    components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0 },
  };
  const zeroDeltas: StrategyRecommendation['deltas'] = {
    lifetimeConsumption: 0,
    totalTax: 0,
    endingAssets: 0,
    pensionEndingBalance: 0,
    comprehensiveTaxYears: 0,
    healthInsuranceTotal: 0,
    nationalPensionTotal: 0,
  };
  const baseRecommendedResult = {
    yearlyResults: [],
    fireAge: null,
    depletionAge: null,
    endingAssets: 0,
    retirementScore: 0,
    retirementGrade: '보통' as const,
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };

  test('recommendation이 undefined이면 폴백 문구를 반환한다', () => {
    const html = renderItemizedChecklistSection(undefined);
    expect(html).toContain('현재 설정이 이미 최적입니다');
  });

  test('improved가 false이면 폴백 문구를 반환한다', () => {
    const recommendation: StrategyRecommendation = {
      currentUtility: utility,
      verifiedSentinelPlan: [],
      recommendedUtility: utility,
      recommendedPlan: null,
      recommendedAssetReinvestment: null,
      recommendedPrivatePensionChanneling: null,
      recommendedNewPensionContribution: null,
      channelingIncludesAccountTransfer: false,
      improved: false,
      reasons: [],
      deltas: zeroDeltas,
      totalCandidateCount: 0,
      failedCandidateCount: 0,
      recommendedResult: baseRecommendedResult,
      itemizedContributions: [],
    };
    const html = renderItemizedChecklistSection(recommendation);
    expect(html).toContain('현재 설정이 이미 최적입니다');
  });

  test('itemizedContributions를 항목별 +/-효용 점수와 함께 렌더링한다', () => {
    const recommendation: StrategyRecommendation = {
      currentUtility: utility,
      verifiedSentinelPlan: [],
      recommendedUtility: { ...utility, score: 81 },
      recommendedPlan: null,
      recommendedAssetReinvestment: null,
      recommendedPrivatePensionChanneling: null,
      recommendedNewPensionContribution: null,
      channelingIncludesAccountTransfer: false,
      improved: true,
      reasons: [],
      deltas: zeroDeltas,
      totalCandidateCount: 12,
      failedCandidateCount: 0,
      recommendedResult: baseRecommendedResult,
      itemizedContributions: [
        { field: 'nationalPensionStartAge', label: '국민연금을 70세까지 연기 수령합니다.', utilityDelta: 5, deltas: { ...zeroDeltas, totalTax: -1000000 } },
        { field: 'privatePensionMonthlyTarget', label: '사적연금을 63세부터 인출합니다.', utilityDelta: -1.2, deltas: zeroDeltas },
      ],
    };
    const html = renderItemizedChecklistSection(recommendation);
    expect(html).toContain('국민연금을 70세까지 연기 수령합니다.');
    expect(html).toContain('단독 효용 +5점');
    expect(html).toContain('사적연금을 63세부터 인출합니다.');
    expect(html).toContain('단독 효용 -1.2점');
    expect(html).toContain('전체 조합에서만 유효');
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

describe('renderItemizedChecklistSection - AI 센티널 자동 적용 구분', () => {
  const zeroDeltas: StrategyRecommendation['deltas'] = {
    lifetimeConsumption: 0, totalTax: 0, endingAssets: 0, pensionEndingBalance: 0,
    comprehensiveTaxYears: 0, healthInsuranceTotal: 0, nationalPensionTotal: 0,
  };

  const recommendation = {
    improved: true,
    itemizedContributions: [
      { field: 'nationalPensionStartAge', label: '국민연금을 70세까지 연기 수령합니다.', utilityDelta: 8, deltas: zeroDeltas },
      { field: 'assetReinvestment', label: '"삼성전자"의 배당을 재투자로 전환합니다.', utilityDelta: 5, deltas: zeroDeltas },
    ],
  } as unknown as StrategyRecommendation;

  test('자동 적용된 축은 "이미 반영됨"으로 분리해 인쇄한다', () => {
    const html = renderItemizedChecklistSection(recommendation, ['nationalPensionStartAge']);

    expect(html).toContain('이미 반영됨');
    expect(html).toContain('단독으로도 권장');
    expect(html).toContain('이 값으로 계산 중');
  });

  test('자동 적용이 없으면 종전대로 구분 없이 인쇄한다', () => {
    const html = renderItemizedChecklistSection(recommendation);

    expect(html).not.toContain('이미 반영됨');
    expect(html).not.toContain('이 값으로 계산 중');
    expect(html).toContain('국민연금을 70세까지 연기 수령합니다.');
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

  // 리포트가 지적한 핵심: 두 세계가 각각 이름을 갖고 같은 화면에 놓여야 한다.
  test('확률 결과를 같은 블록에 나란히 싣는다', () => {
    const html = render(0.37, mc(0.37));

    expect(html).toContain('시장 변동성 반영');
    expect(html).toContain('1,000회 시뮬레이션');
    expect(html).toContain('목표 동시 달성 확률 37%');
    expect(html).toContain('생활 유지 37%');
    expect(html).toContain('90세까지 자산 보존 37%');
    expect(html).toContain('중앙값');
    expect(html).toContain('하위 10%');
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

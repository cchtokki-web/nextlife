import { describe, test, expect } from 'vitest';
import {
  renderRiskAlertsSection,
  renderItemizedChecklistSection,
  renderExecutionRoadmapSection,
  renderSensitivityTableSection,
} from '@/web/features/Pdf/pdfReportSections';
import { RiskAlert } from '@/core/usecases/dashboard/computeRiskAlerts';
import { ExecutionRoadmap } from '@/core/usecases/dashboard/computeExecutionRoadmap';
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
      recommendedUtility: utility,
      recommendedPlan: null,
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
      recommendedUtility: { ...utility, score: 81 },
      recommendedPlan: null,
      improved: true,
      reasons: [],
      deltas: zeroDeltas,
      totalCandidateCount: 12,
      failedCandidateCount: 0,
      recommendedResult: baseRecommendedResult,
      itemizedContributions: [
        { label: '국민연금을 70세까지 연기 수령합니다.', utilityDelta: 5, deltas: { ...zeroDeltas, totalTax: -1000000 } },
        { label: '사적연금을 63세부터 인출합니다.', utilityDelta: -1.2, deltas: zeroDeltas },
      ],
    };
    const html = renderItemizedChecklistSection(recommendation);
    expect(html).toContain('국민연금을 70세까지 연기 수령합니다.');
    expect(html).toContain('효용 +5점');
    expect(html).toContain('사적연금을 63세부터 인출합니다.');
    expect(html).toContain('효용 -1.2점');
  });
});

describe('renderExecutionRoadmapSection', () => {
  test('이벤트와 기대수명을 렌더링한다', () => {
    const roadmap: ExecutionRoadmap = {
      events: [
        { age: 60, items: [{ title: '퇴직', description: '상용소득이 종료되고 자산 인출 계획이 시작됩니다.' }] },
        { age: 68, items: [{ title: '국민연금 수령 개시 (연기)', description: '국민연금 수령을 시작합니다.' }] },
      ],
      expectancy: 90,
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
      expectancy: 90,
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
      { key: 'returnDown', label: '투자수익률 -2%p', depletionAge: 82, deltaYears: -6 },
      { key: 'returnUp', label: '투자수익률 +2%p', depletionAge: null, deltaYears: 4 },
    ];
    const html = renderSensitivityTableSection(scenarios);
    expect(html).toContain('투자수익률 -2%p');
    expect(html).toContain('82세');
    expect(html).toContain('투자수익률 +2%p');
    expect(html).toContain('평생 유지');
  });
});

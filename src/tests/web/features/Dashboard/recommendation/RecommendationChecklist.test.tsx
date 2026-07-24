import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecommendationChecklist } from '@/web/features/Dashboard/recommendation/RecommendationChecklist';
import { StrategyRecommendation, SimulationResult, UtilityBreakdown } from '@/core/entities/types';

const emptyResult: SimulationResult = {
  yearlyResults: [],
  fireAge: 65,
  depletionAge: null,
  endingAssets: 0,
  retirementScore: 0,
  retirementGrade: '보통',
  goalAchievementRate: 100,
  retirementAssetsAtRetirement: 0,
};

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

function makeRecommendation(overrides: Partial<StrategyRecommendation>): StrategyRecommendation {
  return {
    currentUtility: utility,
    recommendedUtility: { ...utility, score: 81 },
    recommendedPlan: null,
    improved: false,
    reasons: ['현재 전략이 이미 합리적입니다.'],
    deltas: zeroDeltas,
    totalCandidateCount: 12,
    failedCandidateCount: 0,
    recommendedResult: emptyResult,
    itemizedContributions: [],
    ...overrides,
  };
}

const formatValue = (v: number) => `${v.toLocaleString()}원`;

describe('RecommendationChecklist', () => {
  test('isComputingRecommendation이면 탐색 중 문구를 보여준다', () => {
    render(
      <RecommendationChecklist recommendation={undefined} isComputingRecommendation formatValue={formatValue} />
    );
    expect(screen.getByText(/탐색하고 있습니다/)).toBeInTheDocument();
  });

  test('recommendationFailed이면 실패 문구를 보여준다', () => {
    render(<RecommendationChecklist recommendation={undefined} recommendationFailed formatValue={formatValue} />);
    expect(screen.getByText(/계산하지 못했습니다/)).toBeInTheDocument();
  });

  test('recommendation이 없으면 아무것도 렌더링하지 않는다', () => {
    const { container } = render(<RecommendationChecklist recommendation={undefined} formatValue={formatValue} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('improved가 false이면 reasons 목록을 보여준다', () => {
    render(<RecommendationChecklist recommendation={makeRecommendation({ improved: false })} formatValue={formatValue} />);
    expect(screen.getByText('현재 전략이 이미 합리적입니다.')).toBeInTheDocument();
  });

  test('improved가 true이면 항목별 체크리스트와 총 Utility 개선폭, 각주를 보여준다', () => {
    const recommendation = makeRecommendation({
      improved: true,
      itemizedContributions: [
        {
          label: '국민연금을 70세까지 연기 수령합니다.',
          utilityDelta: 2.3,
          deltas: { ...zeroDeltas, totalTax: -1000000, endingAssets: 5000000 },
        },
      ],
    });
    render(<RecommendationChecklist recommendation={recommendation} formatValue={formatValue} />);

    expect(screen.getByText('국민연금을 70세까지 연기 수령합니다.')).toBeInTheDocument();
    expect(screen.getByText('+2.3 Utility')).toBeInTheDocument();
    expect(screen.getByText('총 +5.0 Utility')).toBeInTheDocument();
    expect(screen.getByText(/상호작용을/)).toBeInTheDocument();
  });

  test('개별 항목의 utilityDelta가 음수(상호작용으로 인한 marginal 손실)여도 이중부호 없이 올바르게 표시한다', () => {
    const recommendation = makeRecommendation({
      improved: true,
      itemizedContributions: [
        {
          label: '국민연금을 60세부터 조기 수령합니다.',
          utilityDelta: -1.2,
          deltas: { ...zeroDeltas, totalTax: 500000 },
        },
      ],
    });
    render(<RecommendationChecklist recommendation={recommendation} formatValue={formatValue} />);

    expect(screen.getByText('-1.2 Utility')).toBeInTheDocument();
    expect(screen.queryByText('+-1.2 Utility')).not.toBeInTheDocument();
  });
});

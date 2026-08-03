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
  householdEndAge: 90,
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
    verifiedSentinelPlan: [],
    recommendedUtility: { ...utility, score: 81 },
    recommendedPlan: null,
    recommendedAssetReinvestment: null,
    recommendedPrivatePensionChanneling: null,
    recommendedNewPensionContribution: null,
    channelingIncludesAccountTransfer: false,
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

  test('improved가 true이면 항목별 체크리스트와 총 효용 개선폭, 각주를 보여준다', () => {
    const recommendation = makeRecommendation({
      improved: true,
      itemizedContributions: [
        {
          field: 'nationalPensionStartAge',
          label: '국민연금을 70세까지 연기 수령합니다.',
          utilityDelta: 2,
          deltas: { ...zeroDeltas, totalTax: -1000000, endingAssets: 5000000 },
        },
      ],
    });
    render(<RecommendationChecklist recommendation={recommendation} formatValue={formatValue} />);

    expect(screen.getByText('국민연금을 70세까지 연기 수령합니다.')).toBeInTheDocument();
    expect(screen.getByText('효용 +2점')).toBeInTheDocument();
    expect(screen.getByText('총 효용 +5점')).toBeInTheDocument();
    expect(screen.getByText(/단독 적용 기준/)).toBeInTheDocument();
  });

  test('개별 항목의 utilityDelta가 음수(상호작용으로 인한 marginal 손실)여도 이중부호 없이 올바르게 표시한다', () => {
    const recommendation = makeRecommendation({
      improved: true,
      itemizedContributions: [
        {
          field: 'nationalPensionStartAge',
          label: '국민연금을 60세부터 조기 수령합니다.',
          utilityDelta: -1,
          deltas: { ...zeroDeltas, totalTax: 500000 },
        },
      ],
    });
    render(<RecommendationChecklist recommendation={recommendation} formatValue={formatValue} />);

    expect(screen.getByText('효용 -1점')).toBeInTheDocument();
    expect(screen.queryByText('효용 +-1점')).not.toBeInTheDocument();
  });

  test('utilityDelta가 0이면(컴포넌트가 이미 만점/바닥이라 반영되지 않는 경우) 효용 +0점으로 표시한다', () => {
    const recommendation = makeRecommendation({
      improved: true,
      itemizedContributions: [
        {
          field: 'assetSellOrderStrategy',
          label: '배당수익률이 높은 자산부터 매도해 향후 금융소득종합과세 위험을 낮춥니다.',
          utilityDelta: 0,
          deltas: { ...zeroDeltas, totalTax: -14820000, endingAssets: 235550000 },
        },
      ],
    });
    render(<RecommendationChecklist recommendation={recommendation} formatValue={formatValue} />);

    expect(screen.getByText('효용 +0점')).toBeInTheDocument();
  });

  describe('AI 센티널로 이미 자동 적용된 항목', () => {
    const twoItems = makeRecommendation({
      improved: true,
      recommendedUtility: { ...utility, score: 84 },
      itemizedContributions: [
        {
          field: 'nationalPensionStartAge',
          label: '국민연금을 70세까지 연기 수령합니다.',
          utilityDelta: 8,
          deltas: zeroDeltas,
        },
        {
          field: 'assetReinvestment',
          label: '"삼성전자"의 배당을 재투자로 전환합니다.',
          utilityDelta: 5,
          deltas: zeroDeltas,
        },
      ],
    });

    const appliedNationalPension = {
      compiled: {} as never,
      appliedFields: ['nationalPensionStartAge'] as const,
      appliedValues: { nationalPensionStartAge: 70 },
    };

    test('자동 적용된 항목은 "이미 반영됨"으로, 나머지는 "남은 할 일"로 나눈다', () => {
      render(
        <RecommendationChecklist
          recommendation={twoItems}
          sentinels={appliedNationalPension}
          currentUtilityScore={79}
          formatValue={formatValue}
        />
      );

      expect(screen.getByText('이미 반영됨')).toBeInTheDocument();
      expect(screen.getByText('남은 할 일')).toBeInTheDocument();
      expect(screen.getByText('이 값으로 계산 중')).toBeInTheDocument();
    });

    test('헤드라인은 baseline이 아니라 지금 화면 값 대비 남은 개선폭을 말한다', () => {
      // recommendedUtility 84, 화면 값 79 → 남은 개선은 5점.
      // baseline(76) 대비 8점을 쓰면 이미 가진 몫까지 앞으로 얻을 것처럼 말하게 된다.
      render(
        <RecommendationChecklist
          recommendation={twoItems}
          sentinels={appliedNationalPension}
          currentUtilityScore={79}
          formatValue={formatValue}
        />
      );

      expect(screen.getByText('남은 개선 +5점')).toBeInTheDocument();
      expect(screen.queryByText('총 효용 +8점')).not.toBeInTheDocument();
    });

    test('남은 할 일이 없으면 추가로 할 일이 없다고 알린다', () => {
      const onlyApplied = makeRecommendation({
        improved: true,
        itemizedContributions: [
          {
            field: 'nationalPensionStartAge',
            label: '국민연금을 70세까지 연기 수령합니다.',
            utilityDelta: 8,
            deltas: zeroDeltas,
          },
        ],
      });

      render(
        <RecommendationChecklist
          recommendation={onlyApplied}
          sentinels={appliedNationalPension}
          currentUtilityScore={81}
          formatValue={formatValue}
        />
      );

      expect(screen.getByText(/추가로 하실 일은 없습니다/)).toBeInTheDocument();
      expect(screen.queryByText('남은 할 일')).not.toBeInTheDocument();
    });

    test('센티널이 없으면 종전대로 전부 할 일로 보여준다', () => {
      render(
        <RecommendationChecklist
          recommendation={twoItems}
          currentUtilityScore={76}
          formatValue={formatValue}
        />
      );

      expect(screen.queryByText('이미 반영됨')).not.toBeInTheDocument();
      expect(screen.getByText('총 효용 +8점')).toBeInTheDocument();
    });
  });
});

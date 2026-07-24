import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiSummaryHero } from '@/web/features/Dashboard/hero/AiSummaryHero';
import { StrategyRecommendation, SimulationResult, UtilityBreakdown } from '@/core/entities/types';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null }),
}));

function makeStreamResponse(lines: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      lines.forEach((line) => controller.enqueue(encoder.encode(line + '\n')));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const utility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0 },
};

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

const zeroDeltas: StrategyRecommendation['deltas'] = {
  lifetimeConsumption: 0,
  totalTax: 0,
  endingAssets: 0,
  pensionEndingBalance: 0,
  comprehensiveTaxYears: 0,
  healthInsuranceTotal: 0,
  nationalPensionTotal: 0,
};

const formatValue = (v: number) => `${v.toLocaleString()}원`;

describe('AiSummaryHero', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStreamResponse([JSON.stringify({ response: '안내 문구' })])));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('utility가 없으면 아무것도 렌더링하지 않는다', () => {
    const { container } = render(
      <AiSummaryHero
        formatValue={formatValue}
        mode="current"
        onToggleMode={vi.fn()}
        canApply={false}
        score={80}
        monthlyTarget={3000000}
        isPro={false}
        depletionAge={null}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('utility가 있으면 헤드라인과 점수를 렌더링한다', () => {
    render(
      <AiSummaryHero
        formatValue={formatValue}
        mode="current"
        onToggleMode={vi.fn()}
        canApply={false}
        score={80}
        monthlyTarget={3000000}
        isPro={false}
        depletionAge={null}
        utility={utility}
        userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 }}
      />
    );
    expect(screen.getByText(/은퇴/)).toBeInTheDocument();
  });

  test('improved 추천이 있으면 Before/After Utility 비교 문구와 추천 적용 버튼을 보여준다', () => {
    const recommendation: StrategyRecommendation = {
      currentUtility: utility,
      recommendedUtility: { ...utility, score: 81 },
      recommendedPlan: null,
      improved: true,
      reasons: ['국민연금을 70세부터 수령합니다.'],
      deltas: { ...zeroDeltas, totalTax: -1000000, endingAssets: 5000000 },
      totalCandidateCount: 12,
      failedCandidateCount: 0,
      recommendedResult: emptyResult,
      itemizedContributions: [],
    };

    render(
      <AiSummaryHero
        formatValue={formatValue}
        mode="current"
        onToggleMode={vi.fn()}
        canApply
        score={80}
        monthlyTarget={3000000}
        isPro={false}
        depletionAge={null}
        utility={utility}
        recommendation={recommendation}
        userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 }}
      />
    );

    expect(screen.getByText(/76.*→.*81/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '추천 적용하기' })).toBeInTheDocument();
  });
});

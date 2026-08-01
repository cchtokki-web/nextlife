import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  householdEndAge: 90,
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
        householdEndAge={90}
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
        householdEndAge={90}
        utility={utility}
        userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 }}
      />
    );
    expect(screen.getByText(/은퇴/)).toBeInTheDocument();
  });

  // 시뮬레이션은 "둘 중 늦게 사망하는 쪽"(가구 종료 나이)까지 돌기 때문에 depletionAge가
  // 본인 기대수명보다 클 수 있다. 헤드라인이 본인 기대수명과 비교하면, 배우자 단독 생존
  // 구간에서 파산하는 계획을 "고갈 위험 없음"이라고 말하게 된다(점수는 위험으로 표시되는데도).
  test('본인 기대수명 이후·가구 종료 나이 이전에 고갈되면 헤드라인이 고갈 위험을 말한다', () => {
    render(
      <AiSummaryHero
        formatValue={formatValue}
        mode="current"
        onToggleMode={vi.fn()}
        canApply={false}
        score={37}
        monthlyTarget={3000000}
        isPro={false}
        depletionAge={76}
        householdEndAge={100}
        utility={utility}
        userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 75, targetMonthlySpending: 3000000 }}
      />
    );

    expect(screen.getByText(/76세에 자산이 고갈될 위험이 있습니다/)).toBeInTheDocument();
  });

  test('improved 추천이 있으면 Before/After Utility 비교 문구와 추천 적용 버튼을 보여준다', () => {
    const recommendation: StrategyRecommendation = {
      currentUtility: utility,
      recommendedUtility: { ...utility, score: 81 },
      recommendedPlan: null,
      recommendedAssetReinvestment: null,
      recommendedPrivatePensionChanneling: null,
      recommendedNewPensionContribution: null,
      channelingIncludesAccountTransfer: false,
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
        householdEndAge={90}
        utility={utility}
        recommendation={recommendation}
        userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 }}
      />
    );

    expect(screen.getByText(/76.*→.*81/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '추천 적용하기' })).toBeInTheDocument();
  });

  test('AI 의견 fetch가 실패하면 상세 의견 패널이 자동으로 펼쳐져 클릭 없이 에러 문구가 보인다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network fail')));

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
        householdEndAge={90}
        utility={utility}
        userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 }}
      />
    );

    await waitFor(() => expect(screen.getByText('AI 의견을 가져오는 데 실패했습니다.')).toBeInTheDocument());
  });

  test('isRuleBased 응답이면 상세 의견 패널이 자동으로 펼쳐져 클릭 없이 안내 배지가 보인다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeStreamResponse([JSON.stringify({ isRuleBased: true, response: '기본 안내' })]))
    );

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
        householdEndAge={90}
        utility={utility}
        userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 }}
      />
    );

    await waitFor(() => expect(screen.getByText('AI 서버 연결 불가 · 기본 안내 표시 중')).toBeInTheDocument());
  });
});

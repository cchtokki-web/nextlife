import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AiSummaryHero } from '@/web/features/Dashboard/hero/AiSummaryHero';
import { computePlanConfidence } from '@/core/usecases/dashboard/computePlanConfidence';
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

// 헤드라인이 서술할 사건과 확률 판정은 이제 호출부가 계산해 내려준다 — 히어로가 직접
// 유도하면 차트 배지·KPI와 다른 근거를 말하게 된다.
const planOutcome = {
  assetStatus: 'sustained' as const,
  investableDepletionAge: null,
  spendingShortfall: null,
};
const planConfidence = computePlanConfidence(80, { spendingSuccessRate: 0.9, assetSuccessRate: 0.9 });

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
        expectancy={90}
        score={80}
        monthlyTarget={3000000}
        isPro={false}
        depletionAge={null}
        planAssetStatus="sustained"
        planOutcome={planOutcome}
        planConfidence={planConfidence}
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
        expectancy={90}
        score={80}
        monthlyTarget={3000000}
        isPro={false}
        depletionAge={null}
        planAssetStatus="sustained"
        planOutcome={planOutcome}
        planConfidence={planConfidence}
        utility={utility}
        userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 }}
      />
    );
    expect(screen.getByText(/90세까지 투자자산이 고갈되지 않고/)).toBeInTheDocument();
  });

  test('기대수명 전에 자산이 소진되면 헤드라인이 그 사실을 말한다', () => {
    render(
      <AiSummaryHero
        formatValue={formatValue}
        mode="current"
        onToggleMode={vi.fn()}
        canApply={false}
        expectancy={90}
        score={37}
        monthlyTarget={3000000}
        isPro={false}
        depletionAge={76}
        planAssetStatus="depleted"
        planOutcome={{ ...planOutcome, assetStatus: 'depleted' }}
        planConfidence={planConfidence}
        utility={utility}
        userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 }}
      />
    );

    expect(screen.getByText(/기대수명 전에 자산이 모두 소진되지만/)).toBeInTheDocument();
  });

  // 기대수명이 expectancy prop과 userProfile.expectancy 두 경로로 들어온다. 두 값이 항상
  // 같은 케이스만 있으면 호출부(DashboardSection)가 엉뚱한 값을 넘겨도 잡히지 않으므로,
  // 어느 쪽이 헤드라인을 지배하는지 고정한다 — 헤드라인은 expectancy prop만 본다.
  test('expectancy prop과 userProfile.expectancy가 다르면 헤드라인은 prop을 쓴다', () => {
    render(
      <AiSummaryHero
        formatValue={formatValue}
        mode="current"
        onToggleMode={vi.fn()}
        canApply={false}
        expectancy={95}
        score={80}
        monthlyTarget={3000000}
        isPro={false}
        depletionAge={null}
        planAssetStatus="sustained"
        planOutcome={planOutcome}
        planConfidence={planConfidence}
        utility={utility}
        userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 }}
      />
    );

    expect(screen.getByText(/95세까지 투자자산이 고갈되지 않고/)).toBeInTheDocument();
    expect(screen.queryByText(/90세까지 투자자산이 고갈되지 않고/)).not.toBeInTheDocument();
  });

  test('improved 추천이 있으면 Before/After Utility 비교 문구와 추천 적용 버튼을 보여준다', () => {
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
        expectancy={90}
        score={80}
        monthlyTarget={3000000}
        isPro={false}
        depletionAge={null}
        planAssetStatus="sustained"
        planOutcome={planOutcome}
        planConfidence={planConfidence}
        utility={utility}
        recommendation={recommendation}
        userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 }}
      />
    );

    expect(screen.getByText(/76.*→.*81/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '추천안 결과 보기' })).toBeInTheDocument();
    expect(screen.getByText('결과 비교용이며 설정은 변경되지 않습니다.')).toBeInTheDocument();
  });

  test('AI 의견 fetch가 실패하면 상세 의견 패널이 자동으로 펼쳐져 클릭 없이 에러 문구가 보인다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network fail')));

    render(
      <AiSummaryHero
        formatValue={formatValue}
        mode="current"
        onToggleMode={vi.fn()}
        canApply={false}
        expectancy={90}
        score={80}
        monthlyTarget={3000000}
        isPro={false}
        depletionAge={null}
        planAssetStatus="sustained"
        planOutcome={planOutcome}
        planConfidence={planConfidence}
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
        expectancy={90}
        score={80}
        monthlyTarget={3000000}
        isPro={false}
        depletionAge={null}
        planAssetStatus="sustained"
        planOutcome={planOutcome}
        planConfidence={planConfidence}
        utility={utility}
        userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 }}
      />
    );

    await waitFor(() => expect(screen.getByText('AI 서버 연결 불가 · 기본 안내 표시 중')).toBeInTheDocument());
  });

  describe('추천 개선 문구의 기준선', () => {
    const withRecommendedScore = (score: number): StrategyRecommendation => ({
      currentUtility: utility,
      verifiedSentinelPlan: [],
      recommendedUtility: { ...utility, score },
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
      recommendedResult: emptyResult,
      itemizedContributions: [],
    });

    const renderWith = (recommendation: StrategyRecommendation, currentScore: number) =>
      render(
        <AiSummaryHero
          formatValue={formatValue}
          mode="current"
          onToggleMode={vi.fn()}
          canApply
          expectancy={90}
          score={80}
          monthlyTarget={3000000}
          isPro={false}
          depletionAge={null}
          planAssetStatus="sustained"
        planOutcome={planOutcome}
        planConfidence={planConfidence}
          utility={{ ...utility, score: currentScore }}
          recommendation={recommendation}
          userProfile={{ currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 }}
        />
      );

    test('출발점은 baseline이 아니라 지금 화면이 보여주는 효용이다', () => {
      // 자동 채움이 이미 반영된 상태. baseline(76)을 출발점으로 쓰면 사용자가 이미 가진
      // 몫까지 앞으로 얻을 것처럼 말하게 된다.
      renderWith(withRecommendedScore(84), 79);

      expect(screen.getByText('79 → 84')).toBeInTheDocument();
    });

    test('추천이 지금보다 나을 게 없으면 개선 문구를 아예 내지 않는다', () => {
      // improved는 baseline 대비 판정이라 여전히 true다. 그대로 그리면 "80 → 78"처럼
      // 감소를 초록색 개선으로 표시하게 된다.
      renderWith(withRecommendedScore(78), 80);

      expect(screen.queryByText(/추천 전략 적용 시 평생 효용/)).not.toBeInTheDocument();
    });

    test('추천과 지금 값이 같아도 개선 문구를 내지 않는다', () => {
      renderWith(withRecommendedScore(81), 81);

      expect(screen.queryByText(/추천 전략 적용 시 평생 효용/)).not.toBeInTheDocument();
    });
  });
});

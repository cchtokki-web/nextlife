import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardSection } from '@/web/features/Dashboard/DashboardSection';
import { SimulationParams, SimulationResult, SimulationYearlyResult, StrategyRecommendation, UtilityBreakdown } from '@/core/entities/types';

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

function makeYearlyResult(overrides: Partial<SimulationYearlyResult>): SimulationYearlyResult {
  return {
    age: 60,
    year: 2026,
    totalAssets: 500000000,
    stockAssets: 200000000,
    pensionAssets: 300000000,
    dividendIncome: 0,
    nationalPensionIncome: 0,
    privatePensionIncome: 0,
    pensionIncome: 0,
    otherIncome: 0,
    totalIncome: 0,
    preTaxTotalIncome: 0,
    dividendTaxPaid: 0,
    pensionTaxPaid: 0,
    nationalPensionTaxPaid: 0,
    healthInsurancePaid: 0,
    comprehensiveTaxPaid: 0,
    privatePensionTaxMethod: 'none',
    spending: 36000000,
    hasTaxWarning: false,
    ...overrides,
  };
}

const utility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0 },
};

const result: SimulationResult = {
  yearlyResults: [makeYearlyResult({ age: 60 }), makeYearlyResult({ age: 65, nationalPensionIncome: 12000000 })],
  fireAge: 60,
  depletionAge: null,
  endingAssets: 500000000,
  retirementScore: 88,
  retirementGrade: '안정',
  goalAchievementRate: 100,
  retirementAssetsAtRetirement: 400000000,
  utility,
};

const params: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
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

const recommendation: StrategyRecommendation = {
  currentUtility: utility,
  recommendedUtility: { ...utility, score: 81 },
  recommendedPlan: null,
  improved: true,
  reasons: ['국민연금을 70세부터 수령합니다.'],
  deltas: { ...zeroDeltas, totalTax: -1000000, endingAssets: 5000000 },
  totalCandidateCount: 12,
  failedCandidateCount: 0,
  recommendedResult: result,
  itemizedContributions: [
    { label: '국민연금을 70세까지 연기 수령합니다.', utilityDelta: 5, deltas: { ...zeroDeltas, totalTax: -1000000 } },
  ],
};

describe('DashboardSection - IA 순서', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStreamResponse([JSON.stringify({ response: '안내 문구' })])));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('Hero → KPI → 추천 체크리스트 → 차트 → 전문가 상세 순서로 렌더링된다', () => {
    const { container } = render(
      <DashboardSection params={params} result={result} recommendation={recommendation} />
    );

    const text = container.textContent ?? '';
    const heroIdx = text.indexOf('은퇴');
    const kpiIdx = text.indexOf('예상 순자산');
    const checklistIdx = text.indexOf('AI 추천 전략');
    const chartIdx = text.indexOf('자산 추이 시뮬레이션');
    const expertIdx = text.indexOf('전문가용 상세 분석 더 보기');

    expect(heroIdx).toBeGreaterThanOrEqual(0);
    expect(kpiIdx).toBeGreaterThan(heroIdx);
    expect(checklistIdx).toBeGreaterThan(kpiIdx);
    expect(chartIdx).toBeGreaterThan(checklistIdx);
    expect(expertIdx).toBeGreaterThan(chartIdx);
  });

  test('핵심 KPI 4장(생존가능성/순자산/월생활비/Utility)이 모두 노출된다', () => {
    render(<DashboardSection params={params} result={result} recommendation={recommendation} />);
    expect(screen.getByText(/생존 가능성/)).toBeInTheDocument();
    expect(screen.getByText('예상 순자산')).toBeInTheDocument();
    expect(screen.getByText('예상 월 생활비')).toBeInTheDocument();
    expect(screen.getByText('Lifetime Utility')).toBeInTheDocument();
  });

  test('추천 적용하기 버튼 클릭 시 KPI가 Before에서 After(추천) 값으로 전환된다', () => {
    const afterResult: SimulationResult = { ...result, endingAssets: 999000000, utility: { ...utility, score: 81 } };
    const rec: StrategyRecommendation = { ...recommendation, recommendedResult: afterResult };

    render(<DashboardSection params={params} result={result} recommendation={rec} />);

    expect(screen.queryByText('81점')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '추천 적용하기' }));

    expect(screen.getByText('81점')).toBeInTheDocument();
  });
});

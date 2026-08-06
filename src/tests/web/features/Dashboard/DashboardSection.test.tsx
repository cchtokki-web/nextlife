import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardSection } from '@/web/features/Dashboard/DashboardSection';
import {
  CompleteWithdrawalPlan,
  SimulationParams,
  SimulationResult,
  SimulationYearlyResult,
  StrategyRecommendation,
  UtilityBreakdown,
} from '@/core/entities/types';
import { makeYearlyResult as sharedYearlyResult } from '@/tests/fixtures/yearlyResult';

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

// 공유 픽스처(전부 0) 위에 이 파일 공통의 값을 얹는다.
function makeYearlyResult(overrides: Partial<SimulationYearlyResult>): SimulationYearlyResult {
  return sharedYearlyResult({
    age: 60,
    year: 2026,
    totalAssets: 500000000,
    stockAssets: 200000000,
    pensionAssets: 300000000,
    spending: 36000000,
    ...overrides,
  });
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
  householdEndAge: 90,
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
  recommendedResult: result,
  itemizedContributions: [
    { field: 'nationalPensionStartAge', label: '국민연금을 70세까지 연기 수령합니다.', utilityDelta: 5, deltas: { ...zeroDeltas, totalTax: -1000000 } },
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

  test('실행 로드맵이 렌더링되고 체크리스트 다음, 차트 이전에 위치한다', () => {
    const { container } = render(
      <DashboardSection params={params} result={result} recommendation={recommendation} />
    );
    const text = container.textContent ?? '';
    const checklistIdx = text.indexOf('AI 추천 전략');
    const roadmapIdx = text.indexOf('실행 로드맵');
    const chartIdx = text.indexOf('자산 추이 시뮬레이션');

    expect(roadmapIdx).toBeGreaterThan(checklistIdx);
    expect(chartIdx).toBeGreaterThan(roadmapIdx);
  });

  test('전문가용 상세 분석 Collapse를 열지 않아도 평생 효용 점수 구성이 바로 보인다', () => {
    render(<DashboardSection params={params} result={result} recommendation={recommendation} />);
    expect(screen.getByText('평생 효용 점수 구성')).toBeInTheDocument();
    expect(screen.getByText('장점')).toBeInTheDocument();
  });

  test('자산 추이 차트는 기본으로 단순화 모드이며, "자산 구성 상세보기" 버튼을 제공한다', () => {
    render(<DashboardSection params={params} result={result} recommendation={recommendation} />);
    expect(screen.getByRole('button', { name: '자산 구성 상세보기' })).toBeInTheDocument();
  });

  test('핵심 KPI 4장(은퇴준비도/순자산/월생활비/Utility)이 모두 노출된다', () => {
    render(<DashboardSection params={params} result={result} recommendation={recommendation} />);
    expect(screen.getByText(/은퇴 준비도/)).toBeInTheDocument();
    expect(screen.getByText('예상 순자산')).toBeInTheDocument();
    expect(screen.getByText('예상 월 생활비')).toBeInTheDocument();
    expect(screen.getByText('평생 효용')).toBeInTheDocument();
  });

  test('추천 적용하기 버튼 클릭 시 KPI가 Before에서 After(추천) 값으로 전환된다', () => {
    const afterResult: SimulationResult = { ...result, endingAssets: 999000000, utility: { ...utility, score: 81 } };
    const rec: StrategyRecommendation = { ...recommendation, recommendedResult: afterResult };

    render(<DashboardSection params={params} result={result} recommendation={rec} />);

    expect(screen.queryByText('81점')).not.toBeInTheDocument();
    expect(screen.getByText('5억원')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '추천 적용하기' }));

    expect(screen.getByText('81점')).toBeInTheDocument();
    // 순자산 KPI도 endingAssets(자산증가분)를 그대로 반영해야 한다 — utilityScore 하나만으로는
    // 다른 하위 컴포넌트에 baseline 값이 잘못 배선돼도 잡아내지 못한다.
    expect(screen.getByText('9억 9,900만원')).toBeInTheDocument();
    expect(screen.queryByText('5억원')).not.toBeInTheDocument();
  });

  test('추천안에 생활비 배수(monthlySpendingMultiplier)가 포함되면 After 모드에서 예상 월 생활비 KPI가 그만큼 늘어난다', () => {
    const recommendedPlan: CompleteWithdrawalPlan = {
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 65,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1.2,
    };
    const rec: StrategyRecommendation = { ...recommendation, recommendedPlan };

    render(<DashboardSection params={params} result={result} recommendation={rec} />);

    expect(screen.getByText('300만원')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '추천 적용하기' }));

    expect(screen.getByText('360만원')).toBeInTheDocument();
    expect(screen.queryByText('300만원')).not.toBeInTheDocument();
  });

  test('Before 상태에서 리스크 알림이 보이고, 추천 적용(After) 시 리스크가 해소되면 알림이 사라진다', () => {
    const riskyResult: SimulationResult = {
      ...result,
      yearlyResults: [makeYearlyResult({ age: 60 }), makeYearlyResult({ age: 65, nationalPensionIncome: 12000000, hasTaxWarning: true })],
    };
    const cleanAfterResult: SimulationResult = { ...result, endingAssets: 999000000, utility: { ...utility, score: 81 } };
    const rec: StrategyRecommendation = { ...recommendation, recommendedResult: cleanAfterResult };

    render(<DashboardSection params={params} result={riskyResult} recommendation={rec} />);

    expect(screen.getByText('금융소득종합과세 진입 가능성')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '추천 적용하기' }));

    expect(screen.queryByText('금융소득종합과세 진입 가능성')).not.toBeInTheDocument();
  });
});

// **엔진이 계산해 두고도 화면이 침묵하던 값.**
//
// SimulationEngine.run은 'target' 전략에서도 findMaxSustainableValue로 "월 얼마까지 쓸 수
// 있는가"를 계산해 calculatedTargetSpending에 담는다. 그런데 배너 조건이
// spendingStrategy === 'max_sustainable'로 묶여 있어, 고정 생활비로 계획한 사용자는
// 상속 목표가 0원인데 수억을 남기거나 반대로 자산이 고갈되는데도 아무 말을 듣지 못했다.
describe('DashboardSection - 지속가능 생활비 제안 배너', () => {
  test('더 쓸 수 있으면 그 금액을 제안한다', () => {
    const richResult: SimulationResult = { ...result, calculatedTargetSpending: 4420000 };

    render(<DashboardSection params={params} result={richResult} />);

    expect(screen.getByText(/442만원/)).toBeInTheDocument();
    expect(screen.getByText(/더 쓸 수 있습니다/)).toBeInTheDocument();
  });

  test('목표가 지속 불가능하면 줄여야 할 금액을 경고한다', () => {
    const tightResult: SimulationResult = { ...result, calculatedTargetSpending: 2400000 };

    render(<DashboardSection params={params} result={tightResult} />);

    expect(screen.getByText(/240만원/)).toBeInTheDocument();
    expect(screen.getByText(/지속하기 어렵습니다/)).toBeInTheDocument();
  });

  test('차이가 미미하면 배너를 띄우지 않는다', () => {
    const closeResult: SimulationResult = { ...result, calculatedTargetSpending: 3100000 };

    render(<DashboardSection params={params} result={closeResult} />);

    expect(screen.queryByText(/더 쓸 수 있습니다/)).not.toBeInTheDocument();
    expect(screen.queryByText(/지속하기 어렵습니다/)).not.toBeInTheDocument();
  });

  // max_sustainable은 이미 그 값이 실제 생활비로 적용된 상태라, 기존 "최대 고정 생활비
  // 산출 완료" 배너가 담당한다. 두 배너가 같은 숫자를 두 번 말하면 안 된다.
  test('max_sustainable 전략에서는 제안 배너 대신 기존 적용 배너만 보여준다', () => {
    const maxSusParams: SimulationParams = { ...params, spendingStrategy: 'max_sustainable' };
    const maxSusResult: SimulationResult = { ...result, calculatedTargetSpending: 4420000 };

    render(<DashboardSection params={maxSusParams} result={maxSusResult} />);

    expect(screen.queryByText(/더 쓸 수 있습니다/)).not.toBeInTheDocument();
    expect(screen.getByText('최대 고정 생활비 산출 완료')).toBeInTheDocument();
  });
});

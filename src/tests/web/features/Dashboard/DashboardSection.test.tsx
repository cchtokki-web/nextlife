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

// 국민연금(본인 180만/배우자 20만)만 등록하고 투자자산을 하나도 넣지 않은 계획.
// 엔진이 첫 해에 depletionAge를 잡으므로, 화면 전체가 "51세에 자산이 고갈될 위험"이라고
// 말하던 것이 이 스위트가 막는 회귀다.
describe('DashboardSection - 투자자산 미보유 계획', () => {
  const noAssetParams: SimulationParams = {
    ...params,
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3500000 },
    assets: [],
    privatePensions: [],
    nationalPension: { expectedMonthlyAmount: 1800000 },
  };

  const noAssetResult: SimulationResult = {
    ...result,
    yearlyResults: [
      sharedYearlyResult({ age: 51, totalAssets: 0 }),
      sharedYearlyResult({ age: 65, totalAssets: 0, nationalPensionIncome: 21600000 }),
      sharedYearlyResult({ age: 90, totalAssets: 0 }),
    ],
    depletionAge: 51,
    endingAssets: 0,
    retirementScore: 32,
    retirementGrade: '위험',
    goalAchievementRate: 55,
    utility: { ...utility, score: 32 },
  };

  test('헤드라인이 고갈이 아니라 투자자산 미보유로 말한다', () => {
    render(<DashboardSection params={noAssetParams} result={noAssetResult} />);

    // 헤드라인·차트 캡션·차트 빈 상태가 모두 같은 사실을 말하므로 헤드라인 문장 전체로 좁힌다.
    expect(
      screen.getAllByText(/위험 수준의 은퇴 준비 상태입니다\. 등록된 투자자산이 없어, 연금 등 고정소득만으로/).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/51세에 자산이 고갈될 위험/)).not.toBeInTheDocument();
  });

  test('자산 추이 차트가 0원 축 대신 안내를 보여주고 상세보기 토글을 숨긴다', () => {
    render(<DashboardSection params={noAssetParams} result={noAssetResult} />);

    expect(screen.getByText(/자산 추이를 표시할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByText('투자자산 없음')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '자산 구성 상세보기' })).not.toBeInTheDocument();
  });

  test('실행 로드맵에서 없는 계좌의 인출 개시와 고갈 노드를 그리지 않는다', () => {
    render(<DashboardSection params={noAssetParams} result={noAssetResult} />);

    expect(screen.queryByText('일반자산 인출 개시')).not.toBeInTheDocument();
    expect(screen.queryByText('사적연금 수령 개시')).not.toBeInTheDocument();
    expect(screen.queryByText('자산 고갈 예상')).not.toBeInTheDocument();
    expect(screen.getByText('퇴직')).toBeInTheDocument();
  });

  // 인출할 자산이 없는 계획에 "인출 전략을 검토하라"고 하면 할 수 없는 일을 시키는 것이 된다.
  test('과소비 배너가 인출 전략 대신 저축·은퇴 시점을 제안한다', () => {
    const overspendingResult: SimulationResult = { ...noAssetResult, calculatedTargetSpending: 1910000 };

    render(<DashboardSection params={noAssetParams} result={overspendingResult} />);

    expect(screen.getByText(/지속하기 어렵습니다/)).toBeInTheDocument();
    expect(screen.getByText(/추가 저축·투자로 자산을 마련해야 합니다/)).toBeInTheDocument();
    expect(screen.queryByText(/인출 전략을 다시 검토/)).not.toBeInTheDocument();
  });
});

// 다른 KPI는 전부 "결과가 이렇다"만 말한다. 사용자가 행동으로 옮길 숫자(얼마가 모자라고
// 얼마를 더 준비해야 하는가)가 화면 어디에도 없었다.
describe('DashboardSection - 현재 계획을 유지하면 요약 카드', () => {
  const shortParams: SimulationParams = {
    ...params,
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 62, targetMonthlySpending: 3500000 },
  };

  const shortResult: SimulationResult = {
    ...result,
    householdEndAge: 62,
    yearlyResults: [60, 61, 62].map((age) =>
      makeYearlyResult({ age, spending: 1910000 * 12 })
    ),
  };

  test('부족액이 있으면 부족 생활비·기간·필요 자산과 가정 각주를 보여준다', () => {
    render(<DashboardSection params={shortParams} result={shortResult} />);

    expect(screen.getByText('현재 계획을 유지하면')).toBeInTheDocument();
    expect(screen.getByText('부족 생활비')).toBeInTheDocument();
    expect(screen.getByText('부족 기간')).toBeInTheDocument();
    expect(screen.getByText('추가로 필요한 자산')).toBeInTheDocument();
    // 가정을 밝히지 않으면 사용자가 확정된 목표 금액으로 읽는다.
    expect(screen.getByText(/수익률이 물가상승률과 같다고 볼 때/)).toBeInTheDocument();
  });

  test('부족액이 없으면 카드를 렌더링하지 않는다', () => {
    const enoughResult: SimulationResult = {
      ...shortResult,
      yearlyResults: [60, 61, 62].map((age) => makeYearlyResult({ age, spending: 3500000 * 12 })),
    };

    render(<DashboardSection params={shortParams} result={enoughResult} />);

    expect(screen.queryByText('현재 계획을 유지하면')).not.toBeInTheDocument();
  });
});

// 예전에는 로드맵이 토글과 무관하게 항상 추천안을 그렸다. 그래서 Hero 버튼이 "추천 적용하기"
// 상태(= 미적용)인데도 로드맵만 추천 나이를 보여줘, 한 화면에서 KPI·차트와 다른 기준을 말했다.
describe('DashboardSection - 실행 로드맵이 Before/After 토글을 따른다', () => {
  const earlyPensionPlan: CompleteWithdrawalPlan = {
    privatePensionMonthlyTarget: 0,
    nationalPensionStartAge: 60, // 현재 설정(65)에서 조기수령으로 당겨짐
    assetSellOrderStrategy: 'input_order',
    isaMaturityDestination: 'pension',
    generalAssetWithdrawalStartAge: 60,
    monthlySpendingMultiplier: 1,
  };
  const rec: StrategyRecommendation = { ...recommendation, recommendedPlan: earlyPensionPlan };

  test('기본(추천 미적용)에서는 현재 설정 기준으로 그리고 변경 배지를 붙이지 않는다', () => {
    render(<DashboardSection params={params} result={result} recommendation={rec} />);

    expect(screen.getByText(/현재 설정 기준/)).toBeInTheDocument();
    expect(screen.queryByText(/현재 65세 → 추천 60세/)).not.toBeInTheDocument();
    // 국민연금은 현재 설정인 65세 노드에 있어야 한다.
    expect(screen.getByText('65세')).toBeInTheDocument();
  });

  test('추천 적용 시 추천 기준으로 바뀌고 옮겨진 나이를 배지로 밝힌다', () => {
    render(<DashboardSection params={params} result={result} recommendation={rec} />);

    fireEvent.click(screen.getByRole('button', { name: '추천 적용하기' }));

    expect(screen.getByText(/AI 추천 전략 기준/)).toBeInTheDocument();
    expect(screen.getByText('현재 65세 → 추천 60세')).toBeInTheDocument();
  });
});

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';

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

// KPI 카드 하나로 좁혀 그 값만 읽는다. 「지속가능 생활비」와 「목표 생활비」가 같은 금액인
// 계획이 흔해서, 좁히지 않으면 한쪽만 바뀌는 회귀를 잡지 못한다.
const kpiValue = (label: string): string =>
  screen.getByText(label).closest('div')!.parentElement!.querySelector('.font-display')!.textContent!;

describe('DashboardSection - IA 순서', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStreamResponse([JSON.stringify({ response: '안내 문구' })])));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('결과 요약 → 위험 분석 → 실행 계획 → 자산 흐름 → 상세 분석 순서로 렌더링된다', () => {
    const { container } = render(
      <DashboardSection params={params} result={result} recommendation={recommendation} />
    );

    const text = container.textContent ?? '';
    const summaryIdx = text.indexOf('결과 요약');
    const riskIdx = text.indexOf('위험 분석');
    const actionIdx = text.indexOf('실행 계획');
    const chartIdx = text.indexOf('자산 흐름');
    const detailIdx = text.indexOf('상세 분석');

    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(riskIdx).toBeGreaterThan(summaryIdx);
    expect(actionIdx).toBeGreaterThan(riskIdx);
    expect(chartIdx).toBeGreaterThan(actionIdx);
    expect(detailIdx).toBeGreaterThan(chartIdx);
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

  test('소득·지출 구성은 한 자리에서 탭으로 전환된다', () => {
    render(<DashboardSection params={params} result={result} recommendation={recommendation} />);

    const incomeTab = screen.getByRole('tab', { name: '소득 구성' });
    const spendingTab = screen.getByRole('tab', { name: '지출 구성' });
    expect(incomeTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/연령별 소득원 구성/)).toBeInTheDocument();

    fireEvent.click(spendingTab);

    expect(spendingTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/은퇴 후 연령별 월 생활비 재원 구성/)).toBeInTheDocument();
    expect(screen.queryByText(/연령별 소득원 구성/)).not.toBeInTheDocument();
  });

  // KPI 4장은 사용자가 실제로 묻는 네 가지다: 이 계획이 될 확률은 / 실제로 얼마를 쓸 수
  // 있나 / 원한 금액과 얼마나 차이 나나 / 가장 위험한 구간은 언제인가.
  // 기말 순자산과 평생 효용은 카드에서 내려 보조 행으로 강등했다(CoreKpiGrid 주석 참고).
  test('핵심 KPI 4장(목표 성공확률/실제 소비/목표 생활비/부족 발생)이 모두 노출된다', () => {
    render(<DashboardSection params={params} result={result} recommendation={recommendation} />);
    expect(screen.getByText('정량 목표 성공 확률')).toBeInTheDocument();
    expect(screen.getByText('현재 전략 평균 실제 소비')).toBeInTheDocument();
    expect(screen.getByText('목표 생활비')).toBeInTheDocument();
    expect(screen.getByText('생활비 부족 발생')).toBeInTheDocument();
    expect(screen.getByText(/기준 수익률상 지속가능 생활비/)).toBeInTheDocument();
    // 강등된 두 지표도 화면에서 사라지지는 않는다(평생 효용은 상세 분석에도 나오므로 복수).
    expect(screen.getByText(/예상 순자산/)).toBeInTheDocument();
    expect(screen.getAllByText(/평생 효용/).length).toBeGreaterThan(0);
  });

  test('추천안 결과 보기 버튼 클릭 시 KPI가 Before에서 After(추천) 값으로 전환된다', () => {
    const afterResult: SimulationResult = { ...result, endingAssets: 999000000, utility: { ...utility, score: 81 } };
    const rec: StrategyRecommendation = { ...recommendation, recommendedResult: afterResult };

    render(<DashboardSection params={params} result={result} recommendation={rec} />);

    expect(screen.queryByText('81점')).not.toBeInTheDocument();
    expect(screen.getByText('5억원')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '추천안 결과 보기' }));

    expect(screen.getByText('81점')).toBeInTheDocument();
    // 순자산 KPI도 endingAssets(자산증가분)를 그대로 반영해야 한다 — utilityScore 하나만으로는
    // 다른 하위 컴포넌트에 baseline 값이 잘못 배선돼도 잡아내지 못한다.
    expect(screen.getByText('9억 9,900만원')).toBeInTheDocument();
    expect(screen.queryByText('5억원')).not.toBeInTheDocument();
  });

  test('After 모드에서는 추천 결과의 평균 실제 소비 metric을 표시한다', () => {
    const recommendedPlan: CompleteWithdrawalPlan = {
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 65,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1.2,
    };
    const recommendedResult: SimulationResult = {
      ...result,
      yearlyResults: result.yearlyResults.map((row) => ({ ...row, spending: 43_200_000 })),
    };
    const rec: StrategyRecommendation = { ...recommendation, recommendedPlan, recommendedResult };

    render(<DashboardSection params={params} result={result} recommendation={rec} />);

    expect(kpiValue('현재 전략 평균 실제 소비')).toBe('월 300만원');

    fireEvent.click(screen.getByRole('button', { name: '추천안 결과 보기' }));

    expect(kpiValue('현재 전략 평균 실제 소비')).toBe('월 360만원');
    expect(kpiValue('목표 생활비')).toBe('월 300만원');
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

    fireEvent.click(screen.getByRole('button', { name: '추천안 결과 보기' }));

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
  test('지속가능 생활비는 목표액과 분리해 엔진 역산액을 표시한다', () => {
    const tightResult: SimulationResult = { ...result, calculatedTargetSpending: 2160000 };

    render(<DashboardSection params={params} result={tightResult} />);

    expect(screen.getByText(/기준 수익률상 지속가능 생활비/).parentElement).toHaveTextContent('월 216만원');
    expect(kpiValue('목표 생활비')).toBe('월 300만원');
  });

  test('더 쓸 수 있으면 그 금액을 제안한다', () => {
    const richResult: SimulationResult = { ...result, calculatedTargetSpending: 4420000 };

    render(<DashboardSection params={params} result={richResult} />);

    expect(screen.getAllByText(/442만원/).length).toBeGreaterThan(0);
    expect(screen.getByText(/더 쓸 수 있습니다/)).toBeInTheDocument();
  });

  test('목표가 지속 불가능하면 줄여야 할 금액을 경고한다', () => {
    const tightResult: SimulationResult = { ...result, calculatedTargetSpending: 2400000 };

    render(<DashboardSection params={params} result={tightResult} />);

    expect(screen.getAllByText(/240만원/).length).toBeGreaterThan(0);
    expect(screen.getByText(/지속하기 어렵습니다/)).toBeInTheDocument();
  });

  test('차이가 미미하면 배너를 띄우지 않는다', () => {
    const closeResult: SimulationResult = { ...result, calculatedTargetSpending: 3100000 };

    render(<DashboardSection params={params} result={closeResult} />);

    expect(screen.queryByText(/더 쓸 수 있습니다/)).not.toBeInTheDocument();
    expect(screen.queryByText(/지속하기 어렵습니다/)).not.toBeInTheDocument();
  });

  // max_sustainable은 이미 그 값이 실제 생활비로 적용된 상태라, 「평생 소비 최적화 결과」
  // 배너가 담당한다. 두 배너가 같은 숫자를 두 번 말하면 안 된다.
  test('max_sustainable 전략에서는 제안 배너 대신 역산 결과 배너만 보여준다', () => {
    const maxSusParams: SimulationParams = { ...params, spendingStrategy: 'max_sustainable' };
    const maxSusResult: SimulationResult = { ...result, calculatedTargetSpending: 4420000 };

    render(<DashboardSection params={maxSusParams} result={maxSusResult} />);

    expect(screen.queryByText(/더 쓸 수 있습니다/)).not.toBeInTheDocument();
    expect(screen.getByText('평생 소비 최적화 결과')).toBeInTheDocument();
  });
});

describe('DashboardSection - 평생 소비 최적화 결과 배너', () => {
  const curve = { breakpointAges: [70, 80], multipliers: [1.2, 1.0, 0.8] };
  const optimizedParams = (overrides: Partial<SimulationParams> = {}): SimulationParams => ({
    ...params,
    spendingStrategy: 'max_sustainable',
    userProfile: { ...params.userProfile, retirementAge: 60, expectancy: 90 },
    ...overrides,
  });
  const optimizedResult: SimulationResult = { ...result, calculatedTargetSpending: 5_000_000 };

  // 배너 안으로 범위를 좁힌다 — 대시보드의 다른 조각에도 리스트와 성공률 문구가 있다.
  const banner = () => screen.getByText('평생 소비 최적화 결과').closest('div')!;
  const bannerItems = () => within(banner()).queryAllByRole('listitem').map((el) => el.textContent);

  test('곡선이 없으면 단일 금액을 말한다', () => {
    render(<DashboardSection params={optimizedParams()} result={optimizedResult} />);

    expect(screen.getByText('평생 소비 최적화 결과')).toBeInTheDocument();
    expect(bannerItems()).toEqual([]);
  });

  test('곡선이 있으면 연령 구간별 금액을 나열한다', () => {
    render(
      <DashboardSection params={optimizedParams({ spendingCurve: curve })} result={optimizedResult} />
    );

    const items = bannerItems();
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/60~69세/);
    expect(items[2]).toMatch(/80~90세/);
  });

  test('목표 상속자산이 있으면 그 금액을 남긴다고 말한다', () => {
    render(
      <DashboardSection
        params={optimizedParams({ spendingCurve: curve, assetFloor: 100_000_000 })}
        result={optimizedResult}
      />
    );

    expect(screen.getByText(/90세에/)).toBeInTheDocument();
  });

  test('역산액이 최소 생활비에 못 미치면 경고한다', () => {
    render(
      <DashboardSection
        params={optimizedParams({
          spendingCurve: curve, // 최저 구간 = 5,000,000 × 0.8 = 400만원
          strategy: { ...DEFAULT_RETIREMENT_STRATEGY, minMonthlySpending: 4_500_000 },
        })}
        result={optimizedResult}
      />
    );

    expect(screen.getByText('역산된 생활비가 최소 기준에 못 미칩니다')).toBeInTheDocument();
  });

  test('최소 생활비를 충족하면 경고하지 않는다', () => {
    render(
      <DashboardSection
        params={optimizedParams({
          spendingCurve: curve,
          strategy: { ...DEFAULT_RETIREMENT_STRATEGY, minMonthlySpending: 3_000_000 },
        })}
        result={optimizedResult}
      />
    );

    expect(screen.queryByText('역산된 생활비가 최소 기준에 못 미칩니다')).not.toBeInTheDocument();
  });

  // successRate가 아니라 spendingSuccessRate를 쓴다. 목표 상속자산을 정하면 엔진이 그 선
  // 아래로 인출을 막아 고갈이 구조적으로 일어나지 않으므로 successRate는 거의 항상 100%다
  // (하니스 실측: 자산 보존 100% / 생활 유지 43%). 배너의 주장이 "이만큼 쓸 수 있다"이므로
  // 물어야 할 확률은 "그 금액을 실제로 다 쓰는 비율"이다.
  test('확률은 자산 보존율이 아니라 생활 유지율을 말한다', () => {
    const { rerender } = render(
      <DashboardSection params={optimizedParams()} result={optimizedResult} monteCarloStatus="running" />
    );
    expect(banner().textContent).not.toMatch(/유지할 확률/);

    rerender(
      <DashboardSection
        params={optimizedParams()} result={optimizedResult}
        monteCarloStatus="done"
        // 배너는 successRate만 읽지만, 같은 화면의 MonteCarloSection이 나머지 필드를
        // 렌더하므로 실제 결과 형태를 그대로 넘긴다.
        monteCarlo={{
          trials: 1000, seed: 20260101, successAge: 90,
          // 목표 상속자산이 고갈을 막아 성공률은 100%지만, 그 금액을 온전히 쓰는 것은
          // 43%뿐인 상황(하니스 실측 형태).
          successRate: 1, spendingSuccessRate: 0.43,
          plannedMonthlySpending: 2230000,
          endingAssets: { p10: 0, p50: 1, p90: 2, mean: 1 },
          assetBand: [], depletion: { count: 0, earliestAge: null, medianAge: null },
          deterministicEndingAssets: 1, worstDecilePath: [],
        }}
      />
    );
    // 위험 분석 섹션도 같은 확률을 말하므로 배너 안으로 좁혀서 본다.
    // successRate 100%가 아니라 spendingSuccessRate 43%를 말해야 한다.
    expect(banner().textContent).toMatch(/43%/);
    expect(banner().textContent).not.toMatch(/100%/);
  });
});

// 국민연금(월 180만)만 등록하고 투자자산을 하나도 넣지 않은 계획.
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
      screen.getAllByText(/등록된 투자자산이 없지만, 연금 등 고정소득이 계획한 생활비를 채웁니다/).length
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
    yearlyResults: [60, 61, 62].map((age) =>
      makeYearlyResult({ age, spending: 1910000 * 12 })
    ),
  };

  test('부족액이 있으면 부족 생활비·기간·필요 자산과 가정 각주를 보여준다', () => {
    render(<DashboardSection params={shortParams} result={shortResult} />);

    expect(screen.getByText('현재 계획을 유지하면')).toBeInTheDocument();
    expect(screen.getByText('계획 기준 평균 부족액')).toBeInTheDocument();
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

  // **리포트가 "목표 월 350만원"과 "부족 생활비 월 평균 0원"을 나란히 찍은 상황.**
  //
  // 「평생 소비 최적화」는 목표를 지속가능액으로 낮춰 잡는다. 계획 기준으로만 보면 부족이
  // 0이라 문제 없는 계획으로 읽히지만, 사용자가 세운 목표에는 매달 118만원이 모자란다.
  describe('평생 소비 최적화 계획', () => {
    const optimizedParams: SimulationParams = {
      ...shortParams,
      spendingStrategy: 'max_sustainable',
    };
    const optimizedResult: SimulationResult = {
      ...result,
      calculatedTargetSpending: 2320000,
      yearlyResults: [60, 61, 62].map((age) => makeYearlyResult({ age, spending: 2320000 * 12 })),
    };

    test('목표 기준 부족을 별도 블록으로 보여준다', () => {
      render(<DashboardSection params={optimizedParams} result={optimizedResult} />);

      expect(screen.getByText('목표 생활비 기준')).toBeInTheDocument();
      expect(screen.getAllByText('지속가능 생활비').length).toBeGreaterThan(0);
      expect(screen.getByText('목표 대비 평균 부족액')).toBeInTheDocument();
    });

    // 예전에는 이 계획에서 "부족 생활비 월 평균 0원 / 부족 기간 3년"이 찍혔다 —
    // 이진탐색 잔차를 부족으로 셌고 금액은 표시 단위 아래라 0원으로 보였기 때문이다.
    test('계획 기준 부족 블록은 띄우지 않고 유지 가능하다고 말한다', () => {
      render(<DashboardSection params={optimizedParams} result={optimizedResult} />);

      expect(screen.queryByText('계획한 생활비조차 채우지 못하는 구간')).not.toBeInTheDocument();
      expect(screen.queryByText('부족 기간')).not.toBeInTheDocument();
      expect(screen.getByText(/기준 수익률이 실현된다는 가정에서는/)).toBeInTheDocument();
    });
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

    fireEvent.click(screen.getByRole('button', { name: '추천안 결과 보기' }));

    expect(screen.getByText(/AI 추천 전략 기준/)).toBeInTheDocument();
    expect(screen.getByText('현재 65세 → 추천 60세')).toBeInTheDocument();
  });
});

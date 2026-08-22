import { describe, test, expect, vi } from 'vitest';
import { initialParams } from '@/infrastructure/storage/localStore';
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
import { NO_GOAL_FAILURE, LEGACY_GOAL_CONDITIONS } from '@/tests/fixtures/goalFailure';
import { resolveSpendingCurve } from '@/core/usecases/spending/spendingCurve';

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
  recommendedParams: initialParams,
  recommendedUtility: { ...utility, score: 81 },
  recommendedPlan: null,
  recommendedAssetReinvestment: null,
  verifiedAssetReinvestment: null,
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

// 진단 카드의 「현재 계획」 dl에서 항목 하나만 읽는다. 「지속가능 생활비」와 「목표 생활비」가
// 같은 금액인 계획이 흔해서, 좁히지 않으면 한쪽만 바뀌는 회귀를 잡지 못한다.
const planFact = (label: string): string =>
  within(screen.getByLabelText('현재 계획')).getByText(label).closest('div')!
    .querySelector('dd')!.textContent!;

describe('DashboardSection - IA 순서', () => {
  test('진단 → 추천 → 계획의 근거 3단으로 렌더링된다', () => {
    const { container } = render(
      <DashboardSection params={params} result={result} recommendation={recommendation} />
    );

    const text = container.textContent ?? '';
    const diagnosisIdx = text.indexOf('현재 계획 진단');
    const recommendIdx = text.indexOf('NextLife 추천');
    const evidenceIdx = text.indexOf('계획의 근거');

    expect(diagnosisIdx).toBeGreaterThanOrEqual(0);
    expect(recommendIdx).toBeGreaterThan(diagnosisIdx);
    expect(evidenceIdx).toBeGreaterThan(recommendIdx);
  });

  test('「계획의 근거」 안은 자산 흐름 → 시장 변동 검증 → 계획 상세 수치 → 실행 시점 순이다', () => {
    const { container } = render(
      <DashboardSection params={params} result={result} recommendation={recommendation} />
    );

    const text = container.textContent ?? '';
    const chartIdx = text.indexOf('자산 흐름');
    const riskIdx = text.indexOf('시장 변동 검증');
    const detailIdx = text.indexOf('계획 상세 수치');
    const actionIdx = text.indexOf('실행 시점');

    expect(chartIdx).toBeGreaterThanOrEqual(0);
    expect(riskIdx).toBeGreaterThan(chartIdx);
    expect(detailIdx).toBeGreaterThan(riskIdx);
    expect(actionIdx).toBeGreaterThan(detailIdx);
  });

  // 「결과 요약」은 진단 카드가 이미 말한 판정·확률·목표 생활비·기말자산을 다른 이름으로 다시
  // 말했고, 체크리스트는 「NextLife 추천」과 다른 축(평생 효용)으로 두 번째 추천을 냈다.
  test('중복이던 결과 요약·효용 점수·두 번째 추천은 더 이상 렌더되지 않는다', () => {
    render(<DashboardSection params={params} result={result} recommendation={recommendation} />);

    expect(screen.queryByText('결과 요약')).not.toBeInTheDocument();
    expect(screen.queryByText('정량 목표 성공 확률')).not.toBeInTheDocument();
    expect(screen.queryByText('현재 전략 평균 실제 소비')).not.toBeInTheDocument();
    expect(screen.queryByText(/평생 효용/)).not.toBeInTheDocument();
    expect(screen.queryByText(/AI 추천 전략/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '추천안 결과 보기' })).not.toBeInTheDocument();
  });

  // 같은 값에 이름을 여러 개 붙이면 사용자는 서로 다른 지표로 읽는다. 정본은 「목표 달성 확률」.
  test('목표 달성 확률은 한 이름으로만 불린다', () => {
    render(<DashboardSection params={params} result={result} recommendation={recommendation} />);

    expect(screen.getByText('목표 달성 확률')).toBeInTheDocument();
    expect(screen.queryByText('현재 목표 달성률')).not.toBeInTheDocument();
    expect(screen.queryByText('목표 성공확률')).not.toBeInTheDocument();
  });

  // LLM 조언 패널을 걷어냈으므로 결과 화면은 네트워크를 전혀 타지 않아야 한다. 남아 있으면
  // 화면에 보이지도 않는 응답을 위해 매 렌더 요청이 나간다.
  test('AI 조언 API를 호출하지 않는다', () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeStreamResponse([JSON.stringify({ response: '안내 문구' })]));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      render(<DashboardSection params={params} result={result} recommendation={recommendation} />);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('Monte Carlo 전에는 고정소득 충당률을 목표 달성 확률로 표시하지 않는다', () => {
    const assetFundedResult: SimulationResult = {
      ...result,
      goalAchievementRate: 30,
      depletionAge: null,
      yearlyResults: result.yearlyResults.map((row) => ({ ...row, unmetSpending: 0 })),
    };

    render(<DashboardSection params={params} result={assetFundedResult} monteCarloStatus="running" />);

    const diagnosis = screen.getByLabelText('현재 계획 분석');
    expect(within(diagnosis).getByText('계산 중')).toBeInTheDocument();
    expect(within(diagnosis).queryByText(/30%/)).not.toBeInTheDocument();
    expect(within(diagnosis).getByText(/기준 시나리오에서는/)).toBeInTheDocument();
  });

  test('실행 로드맵은 「무엇부터 바꿔야 하나」 다음, 차트 이후에 위치한다', () => {
    const { container } = render(
      <DashboardSection params={params} result={result} recommendation={recommendation} />
    );
    const text = container.textContent ?? '';
    const chartIdx = text.indexOf('자산 추이 시뮬레이션');
    const leversIdx = text.indexOf('무엇부터 바꿔야 하나');
    const roadmapIdx = text.indexOf('실행 로드맵');

    expect(chartIdx).toBeGreaterThanOrEqual(0);
    expect(leversIdx).toBeGreaterThan(chartIdx);
    expect(roadmapIdx).toBeGreaterThan(leversIdx);
  });

  // 「계획의 근거」를 한 번 여는 것으로 끝나야 한다. 예전에는 세금 표 하나를 보는 데
  // <details> → 그룹 → Collapse까지 세 번을 열어야 했다.
  test('안쪽에 또 다른 접힘을 두지 않는다', () => {
    const { container } = render(
      <DashboardSection params={params} result={result} recommendation={recommendation} />
    );

    expect(container.querySelectorAll('details')).toHaveLength(1);
    expect(screen.getByText('세금 및 건강보험료 (은퇴 이후 연평균)')).toBeInTheDocument();
  });

  test('계획의 근거 토글은 열기와 닫기 동작을 글로 안내한다', () => {
    const { container } = render(
      <DashboardSection params={params} result={result} recommendation={recommendation} />
    );

    const details = container.querySelector('details');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('자세히 보기')).toBeInTheDocument();
    expect(screen.getByText('접기')).toBeInTheDocument();

    fireEvent.click(container.querySelector('summary')!);

    expect(details).toHaveAttribute('open');
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

  // 진단 카드의 「가장 큰 위험」은 riskAlerts[0]의 제목이고, 위험 카드 목록은 그 항목의
  // 설명과 대응까지 보여준다. 요약 → 상세 관계이므로 제목이 두 번 나오는 것은 의도다.
  test('가장 큰 위험은 진단 카드가 제목으로, 위험 카드가 상세로 말한다', () => {
    const riskParams: SimulationParams = {
      ...params,
      userProfile: { ...params.userProfile, retirementAge: 65 },
      withdrawalPlan: { nationalPensionStartAge: 65 },
    };
    const riskyResult: SimulationResult = {
      ...result,
      yearlyResults: [makeYearlyResult({ age: 65, nationalPensionIncome: 12000000, hasTaxWarning: true })],
    };

    render(<DashboardSection params={riskParams} result={riskyResult} recommendation={recommendation} />);

    const diagnosis = screen.getByLabelText('현재 계획 분석');
    expect(within(diagnosis).getByText('금융소득종합과세 진입 가능성')).toBeInTheDocument();
    expect(screen.getAllByText('금융소득종합과세 진입 가능성').length).toBeGreaterThanOrEqual(2);
  });
});

// 자동 채움(applyAiSentinels)은 사용자가 미정으로 둔 축을 추천값으로 채워 engine.run에
// 넘긴다 — 화면의 숫자가 사용자가 입력한 적 없는 값을 포함한다는 뜻이다. 예전에는 추천
// 체크리스트의 "이미 반영됨" 블록이 그 사실을 말했고, 그 블록을 없앤 뒤에는 진단 카드가 말한다.
describe('DashboardSection - 자동 반영된 설정 표기', () => {
  const diagnosis = () => screen.getByLabelText('현재 계획 분석');

  test('자동으로 채운 축이 있으면 진단 카드가 그 축을 밝힌다', () => {
    render(
      <DashboardSection
        params={params} result={result} recommendation={recommendation}
        sentinels={{
          compiled: { params, utilityConfig: { weights: {} } } as never,
          appliedFields: ['nationalPensionStartAge', 'assetSellOrderStrategy'],
          appliedValues: {},
        }}
      />
    );

    expect(diagnosis().textContent).toMatch(/자동으로 반영했습니다/);
    expect(diagnosis().textContent).toMatch(/국민연금 개시 나이/);
    expect(diagnosis().textContent).toMatch(/자산 매도 순서/);
  });

  test('자동으로 채운 축이 없으면 그 줄을 렌더하지 않는다', () => {
    render(
      <DashboardSection
        params={params} result={result} recommendation={recommendation}
        sentinels={{
          compiled: { params, utilityConfig: { weights: {} } } as never,
          appliedFields: [],
          appliedValues: {},
        }}
      />
    );

    expect(diagnosis().textContent).not.toMatch(/자동으로 반영했습니다/);
  });
});

// **엔진이 계산해 두고도 화면이 침묵하던 값.**
//
// SimulationEngine.run은 'target' 전략에서도 findMaxSustainableValue로 "월 얼마까지 쓸 수
// 있는가"를 계산해 calculatedTargetSpending에 담는다. 그런데 배너 조건이
// spendingStrategy === 'max_sustainable'로 묶여 있어, 고정 생활비로 계획한 사용자는
// 상속 목표가 0원인데 수억을 남기거나 반대로 자산이 고갈되는데도 아무 말을 듣지 못했다.
// 「생활비 배분」을 고르면 목표 생활비가 나이대별로 달라지는데, 진단 카드는 그 평균을
// 보여준다(SimulationMetricsCalculator의 average(goalMonthly)). 밝히지 않으면 사용자가
// 목표 단계에서 입력한 300만원과 다른 숫자가 이유 없이 서 있게 된다.
describe('DashboardSection - 연령대별 생활비 배분 공개', () => {
  const curved: SimulationParams = { ...params, spendingCurve: resolveSpendingCurve('care_heavy') };

  test('곡선이 있으면 월 생활비 목표가 평균임을 밝힌다', () => {
    render(<DashboardSection params={curved} result={result} />);

    expect(within(screen.getByLabelText('현재 계획')).getByText('월 생활비 목표(평균)'))
      .toBeInTheDocument();
  });

  test('연령대별 금액을 구간으로 나열한다', () => {
    render(<DashboardSection params={curved} result={result} />);

    // 은퇴 60세·기대수명 90세, 완만한 감소형(1 / 0.93 / 0.88), 기준 300만원.
    const note = screen.getByTestId('spending-band-note');
    expect(note).toHaveTextContent('60~69세');
    expect(note).toHaveTextContent('300만원');
    expect(note).toHaveTextContent('80~90세');
    expect(note).toHaveTextContent('264만원');
  });

  test('곡선이 없으면 평균이라고 하지도, 구간을 나열하지도 않는다', () => {
    render(<DashboardSection params={params} result={result} />);

    expect(planFact('월 생활비 목표')).toBeTruthy();
    expect(screen.queryByTestId('spending-band-note')).not.toBeInTheDocument();
  });
});

describe('DashboardSection - 지속가능 생활비 제안 배너', () => {
  test('지속가능 생활비는 목표액과 분리해 엔진 역산액을 표시한다', () => {
    const tightResult: SimulationResult = { ...result, calculatedTargetSpending: 2160000 };

    render(<DashboardSection params={params} result={tightResult} />);

    // 지속가능액(216만)은 과소비 배너가, 사용자가 세운 목표(300만)는 진단 카드가 말한다.
    // 둘이 같은 카드에 붙어 있으면 어느 쪽이 "내가 정한 값"인지 구분되지 않는다.
    expect(screen.getByText(/지속하기 어렵습니다/)).toBeInTheDocument();
    expect(screen.getAllByText(/216만원/).length).toBeGreaterThan(0);
    expect(planFact('월 생활비 목표')).toBe('300만원');
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
          successRate: 1, spendingSuccessRate: 0.43, goalSuccessProbability: 0.43,
          goalFailure: NO_GOAL_FAILURE, goalConditions: LEGACY_GOAL_CONDITIONS,
          plannedMonthlySpending: 2230000,
          endingAssets: { p10: 0, p50: 1, p90: 2 },
          assetBands: [], depletion: { count: 0, earliestAge: null, medianAge: null },
          deterministicEndingAssets: 1,
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

  // 엔진은 첫 해에 depletionAge=51을 잡는다. 화면이 그것을 그대로 결론으로 말하면
  // "51세에 자산이 고갈되는 계획"이 되는데, 실제로는 굴릴 투자자산을 처음부터 넣지 않은 것뿐이다.
  test('고갈이 아니라 투자자산 미보유로 말한다', () => {
    render(<DashboardSection params={noAssetParams} result={noAssetResult} />);

    expect(screen.getByText(/등록된 투자자산이 없어 자산 잔액은 0원으로 유지됩니다/)).toBeInTheDocument();
    expect(screen.queryByText(/51세에 자산이 고갈될 위험/)).not.toBeInTheDocument();
    expect(screen.queryByText(/51세에 투자자산이 모두 소진/)).not.toBeInTheDocument();
  });

  test('자산 추이 차트가 0원 축 대신 안내를 보여주고 상세보기 토글을 숨긴다', () => {
    render(<DashboardSection params={noAssetParams} result={noAssetResult} />);

    expect(screen.getByText(/자산 추이를 표시할 수 없습니다/)).toBeInTheDocument();
    // 펼칠 구성(주식/연금/ISA/현금)이 전부 0원이라 토글이 있어도 아무 일이 일어나지 않는다.
    expect(screen.queryByRole('button', { name: '자산 구성 상세보기' })).not.toBeInTheDocument();
  });

  // 계획 판정(투자자산 소진 / 생활비 부족 / 유지됨)은 이 카드가 말하지 않는다. 같은 사실을
  // 계획 진단 줄과 「생활비 재원 구성」 캡션, 「계획 상세 수치」가 이미 말하고 있어, 차트
  // 머리의 배지는 가장 좁은 자리에서 같은 말을 반복하며 시선만 먼저 가져갔다.
  test('자산 추이 차트 머리에 계획 판정 배지를 두지 않는다', () => {
    render(<DashboardSection params={params} result={result} />);

    const header = screen.getByText(/자산 추이 시뮬레이션/).closest('div');
    expect(header).not.toBeNull();
    expect(header!.textContent).not.toMatch(/투자자산 소진|생활비 부족|안정적인 노후 자산 유지됨/);
    // 이 카드에서만 할 수 있는 조작은 그대로 남는다.
    expect(screen.getByRole('button', { name: '자산 구성 상세보기' })).toBeInTheDocument();
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

// 예전에는 로드맵만 추천안을 그려서, KPI·차트가 현재 설정을 보여주는데 로드맵은 추천 나이를
// 말했다. 지금 이 화면의 모든 숫자는 현재 계획 하나를 기준으로 하므로 로드맵도 같아야 한다.
// (추천안의 연령별 일정은 「NextLife 추천」 카드의 "달라지는 점"이 담당한다.)
describe('DashboardSection - 실행 로드맵은 언제나 현재 계획 기준이다', () => {
  const earlyPensionPlan: CompleteWithdrawalPlan = {
    privatePensionMonthlyTarget: 0,
    nationalPensionStartAge: 60, // 현재 설정(65)에서 조기수령으로 당겨짐
    assetSellOrderStrategy: 'input_order',
    isaMaturityDestination: 'pension',
    generalAssetWithdrawalStartAge: 60,
    monthlySpendingMultiplier: 1,
  };
  const rec: StrategyRecommendation = { ...recommendation, recommendedPlan: earlyPensionPlan };

  test('추천안이 있어도 현재 설정 기준으로 그리고 변경 배지를 붙이지 않는다', () => {
    render(<DashboardSection params={params} result={result} recommendation={rec} />);

    expect(screen.getByText(/현재 설정 기준/)).toBeInTheDocument();
    expect(screen.queryByText(/AI 추천 전략 기준/)).not.toBeInTheDocument();
    expect(screen.queryByText(/현재 65세 → 추천 60세/)).not.toBeInTheDocument();
    // 국민연금은 현재 설정인 65세 노드에 있어야 한다.
    expect(screen.getByText('65세')).toBeInTheDocument();
  });
});

// C3: "현재 계획 진단" 섹션의 두 가지 결정을 고정한다.
//   (1) 표시하는 확률이 goalSuccessProbability인가 (spendingSuccessRate 대체 금지)
//   (2) 신호등 임계값이 computePlanConfidence의 밴드를 쓰는가 (인라인 0.9/0.7 금지)
// 두 값을 일부러 크게 벌리고, 옛 임계값과 새 임계값의 판정이 갈리는 0.85를 쓴다.
describe('DashboardSection - 현재 계획 진단', () => {
  const diagnosis = () => screen.getByLabelText('현재 계획 분석');

  const monteCarloWith = (goal: number, spending: number) => ({
    trials: 1000, seed: 20260101, successAge: 90,
    successRate: 1,
    spendingSuccessRate: spending,
    goalSuccessProbability: goal,
    goalFailure: NO_GOAL_FAILURE, goalConditions: LEGACY_GOAL_CONDITIONS,
    plannedMonthlySpending: 3_000_000,
    endingAssets: { p10: 0, p50: 1, p90: 2 },
    assetBands: [], depletion: { count: 0, earliestAge: null, medianAge: null },
    deterministicEndingAssets: 1,
  });

  test('생활 유지율이 아니라 목표 성공확률을 표시한다', () => {
    render(
      <DashboardSection
        params={params} result={result}
        monteCarloStatus="done"
        monteCarlo={monteCarloWith(0.85, 0.30)}
      />
    );

    // 두 지표는 정의가 다르다. 대체하면 목표를 못 지키는 계획이 안정적으로 보일 수 있다.
    expect(diagnosis().textContent).toMatch(/85%/);
    expect(diagnosis().textContent).not.toMatch(/30%/);
  });

  test('0.85는 computePlanConfidence 밴드에 따라 안정(🟢)으로 판정한다', () => {
    render(
      <DashboardSection
        params={params} result={result}
        monteCarloStatus="done"
        monteCarlo={monteCarloWith(0.85, 0.85)}
      />
    );

    // 옛 인라인 임계값(>= 0.9)이라면 🟡이 된다. 도메인 밴드는 0.80 이상을 stable(green)로 본다.
    expect(diagnosis().textContent).toContain('🟢');
    expect(diagnosis().textContent).not.toContain('🟡');
  });

  // 확률만 보여주면 사용자는 언제나 "자산 부족"으로 읽는다. 자산이 남아 있는데도 인출
  // 설정 때문에 목표를 못 채우는 계획은 그 사실을 화면에서 읽을 수 있어야 한다.
  test('목표를 달성하지 못한 원인과 그것을 만든 설정을 함께 표시한다', () => {
    render(
      <DashboardSection
        params={{ ...params, withdrawalPlan: { privatePensionMonthlyTarget: 312_500 } }}
        result={result}
        monteCarloStatus="done"
        monteCarlo={{
          ...monteCarloWith(0.02, 0.02),
          goalFailure: {
            spendingShortfall: 980, assetDepletion: 0, terminalShortfall: 5,
            medianFirstShortfallAge: 72, terminalAssetGoal: 0,
          },
        }}
      />
    );

    expect(diagnosis().textContent).toContain('목표를 달성하지 못한 시행의 원인');
    expect(diagnosis().textContent).toContain('980회');
    expect(diagnosis().textContent).toContain('72세부터');
    expect(diagnosis().textContent).toContain('사적연금');
  });

  // 판정하지 않은 목표를 밝히지 않으면 "판정하지 않음"이 "판정해서 통과함"으로 읽힌다.
  test('확률에 반영되지 않은 목표를 밝힌다', () => {
    render(
      <DashboardSection
        params={params} result={result}
        monteCarloStatus="done"
        monteCarlo={{
          ...monteCarloWith(0.9, 0.9),
          goalConditions: {
            basis: 'selected_goals',
            requireSpendingTarget: true,
            requireAssetSurvival: false,
            terminalAssetGoal: 0,
            unmeasuredGoals: ['TAX_OPTIMIZATION', 'PENSION_OPTIMIZATION'],
          },
        }}
      />
    );

    expect(diagnosis().textContent).toContain('반영되지 않은 목표: 세금 최소화, 연금 최대 활용');
  });

  test('판정 가능한 목표가 없으면 기본 조건으로 계산했다고 밝힌다', () => {
    render(
      <DashboardSection
        params={params} result={result}
        monteCarloStatus="done"
        monteCarlo={{
          ...monteCarloWith(0.9, 0.9),
          goalConditions: {
            basis: 'plan_defaults',
            requireSpendingTarget: true,
            requireAssetSurvival: true,
            terminalAssetGoal: 0,
            unmeasuredGoals: ['TAX_OPTIMIZATION'],
          },
        }}
      />
    );

    expect(diagnosis().textContent).toContain('계획의 기본 조건');
  });

  test('레거시 시나리오에는 목표 안내를 붙이지 않는다', () => {
    // 목표를 고른 적 없는 사용자에게 "선택한 목표"를 말하면 없는 선택을 있다고 하는 것이다.
    render(
      <DashboardSection
        params={params} result={result}
        monteCarloStatus="done"
        monteCarlo={monteCarloWith(0.9, 0.9)}
      />
    );

    expect(diagnosis().textContent).not.toContain('반영되지 않은 목표');
    expect(diagnosis().textContent).not.toContain('계획의 기본 조건');
  });

  test('실패 원인이 없으면 이유 블록을 그리지 않는다', () => {
    render(
      <DashboardSection
        params={params} result={result}
        monteCarloStatus="done"
        monteCarlo={monteCarloWith(1, 1)}
      />
    );

    expect(diagnosis().textContent).not.toContain('목표를 달성하지 못한 시행의 원인');
  });

  test('0.60은 주의(🟡)로 판정한다', () => {
    render(
      <DashboardSection
        params={params} result={result}
        monteCarloStatus="done"
        monteCarlo={monteCarloWith(0.60, 0.60)}
      />
    );

    // 옛 인라인 임계값(>= 0.7 미만은 🔴)이라면 🔴이 된다. 도메인 밴드는 0.50 이상을 orange로 본다.
    expect(diagnosis().textContent).toContain('🟡');
    expect(diagnosis().textContent).not.toContain('🔴');
  });

  // 이 카드의 확률과 실패 시행 수는 몬테카를로인데 「예상자산」만 결정론 1회 실행이었다.
  // 두 값은 같은 계획에서도 크게 벌어진다(실측 11.44억 대 2.67억) — 사용자에게는 추천을
  // 적용하면 자산이 반토막 나는 것처럼 읽혔다. 기준을 하나로 맞추고, 어느 기준인지 밝힌다.
  const facts = () => within(diagnosis()).getByLabelText('현재 계획');

  test('몬테카를로가 끝나면 예상자산은 중앙값을 쓴다', () => {
    render(
      <DashboardSection
        params={params} result={result}
        monteCarloStatus="done"
        monteCarlo={{
          ...monteCarloWith(0.67, 0.67),
          endingAssets: { p10: 0, p50: 100_000_000, p90: 900_000_000 },
        }}
      />
    );

    // result.endingAssets는 5억이다. 그 값이 이 칸에 남아 있으면 기준이 섞인 상태 그대로다.
    expect(within(facts()).getByText('90세 예상자산(중앙값)')).toBeInTheDocument();
    expect(facts().textContent).toContain('1억원');
    expect(facts().textContent).not.toContain('5억원');
  });

  test('중앙값을 쓸 때 기준 수익률 경로의 값을 함께 밝힌다', () => {
    render(
      <DashboardSection
        params={params} result={result}
        monteCarloStatus="done"
        monteCarlo={{
          ...monteCarloWith(0.67, 0.67),
          endingAssets: { p10: 0, p50: 100_000_000, p90: 900_000_000 },
        }}
      />
    );

    // 자산 추이 차트는 흔들리지 않는 경로라 5억에서 끝난다. 밝히지 않으면 KPI와 차트가
    // 이유 없이 어긋난 채로 남는다.
    const note = screen.getByTestId('terminal-asset-basis-note');
    expect(note.textContent).toContain('1,000회');
    expect(note.textContent).toContain('5억원');
  });

  test('몬테카를로 전에는 기준 수익률 경로임을 밝히고 그 값을 쓴다', () => {
    render(<DashboardSection params={params} result={result} monteCarloStatus="running" />);

    // 칸을 비우면 계산이 실패한 것으로 읽힌다. 대신 무엇을 보고 있는지를 말한다.
    expect(within(facts()).getByText('90세 예상자산(기준 수익률)')).toBeInTheDocument();
    expect(facts().textContent).toContain('5억원');
    expect(screen.queryByTestId('terminal-asset-basis-note')).not.toBeInTheDocument();
  });
});

import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetGrowthChart, buildAssetChartData } from '@/web/features/Dashboard/charts/AssetGrowthChart';
import { MonteCarloResult } from '@/core/entities/montecarlo';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';
import { makeYearlyResult as sharedYearlyResult } from '@/tests/fixtures/yearlyResult';
import { NO_GOAL_FAILURE, LEGACY_GOAL_CONDITIONS } from '@/tests/fixtures/goalFailure';

// 차트 테스트는 "자산이 있는" 상태가 기본이라야 시리즈가 그려진다. 공유 픽스처(전부 0) 위에
// 이 파일 공통의 잔액을 얹는다.
function makeYearlyResult(overrides: Partial<SimulationYearlyResult>): SimulationYearlyResult {
  return sharedYearlyResult({
    totalAssets: 500000000,
    stockAssets: 200000000,
    pensionAssets: 300000000,
    spending: 36000000,
    ...overrides,
  });
}

const result: SimulationResult = {
  yearlyResults: [makeYearlyResult({ age: 60 })],
  fireAge: 60,
  depletionAge: null,
  endingAssets: 500000000,
  retirementScore: 88,
  retirementGrade: '안정',
  goalAchievementRate: 100,
  retirementAssetsAtRetirement: 400000000,
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

describe('AssetGrowthChart - 단순화 모드 토글', () => {
  test('간단히 보기에서는 강제로 숨긴 자산 구성 범례를 노출하지 않는다', () => {
    const { rerender } = render(
      <AssetGrowthChart
        params={params}
        result={result}
        compareResults={[]}
        hiddenKeys={{ 주식자산: true, 연금자산: true }}
        onLegendClick={() => {}}
        caption=""
        showBreakdown={false}
        onToggleBreakdown={() => {}}
        planOutcome={{ assetStatus: 'sustained', investableDepletionAge: null, spendingShortfall: null }}
      />
    );

    expect(screen.queryByRole('button', { name: /주식\/ETF 자산/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /연금 자산/ })).not.toBeInTheDocument();
    // ISA·현금도 구성 계열이다. 총액이 중앙값일 때 이 점선들만 기준 수익률로 남으면
    // 한 화면에서 부분과 전체가 다른 기준을 말한다.
    expect(screen.queryByRole('button', { name: /ISA 자산/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^현금/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /총 자산액/ })).toBeInTheDocument();

    rerender(
      <AssetGrowthChart
        params={params}
        result={result}
        compareResults={[]}
        hiddenKeys={{}}
        onLegendClick={() => {}}
        caption=""
        showBreakdown={true}
        onToggleBreakdown={() => {}}
        planOutcome={{ assetStatus: 'sustained', investableDepletionAge: null, spendingShortfall: null }}
      />
    );

    expect(screen.getByRole('button', { name: /주식\/ETF 자산/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /연금 자산/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ISA 자산/ })).toBeInTheDocument();
  });

  test('showBreakdown이 false면 "자산 구성 상세보기" 버튼을, true면 "간단히 보기" 버튼을 보여준다', () => {
    const { rerender } = render(
      <AssetGrowthChart
        params={params}
        result={result}
        compareResults={[]}
        hiddenKeys={{}}
        onLegendClick={() => {}}
        caption=""
        showBreakdown={false}
        onToggleBreakdown={() => {}}
        planOutcome={{ assetStatus: 'sustained', investableDepletionAge: null, spendingShortfall: null }}
      />
    );
    expect(screen.getByRole('button', { name: '자산 구성 상세보기' })).toBeInTheDocument();

    rerender(
      <AssetGrowthChart
        params={params}
        result={result}
        compareResults={[]}
        hiddenKeys={{}}
        onLegendClick={() => {}}
        caption=""
        showBreakdown={true}
        onToggleBreakdown={() => {}}
        planOutcome={{ assetStatus: 'sustained', investableDepletionAge: null, spendingShortfall: null }}
      />
    );
    expect(screen.getByRole('button', { name: '간단히 보기' })).toBeInTheDocument();
  });

  test('토글 버튼 클릭 시 onToggleBreakdown이 호출된다', () => {
    const onToggleBreakdown = vi.fn();
    render(
      <AssetGrowthChart
        params={params}
        result={result}
        compareResults={[]}
        hiddenKeys={{}}
        onLegendClick={() => {}}
        caption=""
        showBreakdown={false}
        onToggleBreakdown={onToggleBreakdown}
        planOutcome={{ assetStatus: 'sustained', investableDepletionAge: null, spendingShortfall: null }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '자산 구성 상세보기' }));
    expect(onToggleBreakdown).toHaveBeenCalledTimes(1);
  });
});

// 총 자산액 곡선의 기준. 예전에는 결정론 1회 실행이었고 그 옆에 「나쁜 경우(하위 10%)」
// 점선을 함께 그렸다. 진단 카드의 「N세 예상자산」이 중앙값이 된 뒤로 그 곡선만 다른 기준을
// 말하게 되어, 곡선을 중앙값으로 바꾸고 하방 선은 걷어냈다.
describe('AssetGrowthChart - 총 자산액 곡선의 기준', () => {
  const monteCarlo: MonteCarloResult = {
    trials: 1000,
    seed: 1,
    successAge: 90,
    successRate: 0.39,
    spendingSuccessRate: 0.39,
    goalSuccessProbability: 0.39,
    goalFailure: NO_GOAL_FAILURE, goalConditions: LEGACY_GOAL_CONDITIONS,
    plannedMonthlySpending: 2230000,
    endingAssets: { p10: 0, p50: 100000000, p90: 8000000000 },
    assetBands: [{ age: 60, p10: 10000000, p50: 250000000 }],
    depletion: { count: 610, earliestAge: 72, medianAge: 84 },
    deterministicEndingAssets: 500000000,
  };

  const renderChart = (props: Partial<React.ComponentProps<typeof AssetGrowthChart>> = {}) =>
    render(
      <AssetGrowthChart
        params={params}
        result={result}
        compareResults={[]}
        hiddenKeys={{}}
        onLegendClick={() => {}}
        caption=""
        showBreakdown={false}
        onToggleBreakdown={() => {}}
        planOutcome={{ assetStatus: 'sustained', investableDepletionAge: null, spendingShortfall: null }}
        monteCarlo={monteCarlo}
        {...props}
      />
    );

  test('모든 해에 밴드가 있으면 총 자산액을 중앙값으로 그린다', () => {
    const data = buildAssetChartData(result.yearlyResults, [], new Map(
      monteCarlo.assetBands.map((b) => [b.age, b])
    ));

    expect(data.usesMedian).toBe(true);
    expect(data.rows[0]['자산총액']).toBe(250000000);
  });

  test('밴드가 없으면 기준 수익률 경로 값을 그대로 쓴다', () => {
    const data = buildAssetChartData(result.yearlyResults, [], undefined);

    expect(data.usesMedian).toBe(false);
    expect(data.rows[0]['자산총액']).toBe(500000000);
  });

  // 해마다 기준이 갈리면 한 곡선 안에서 두 기준이 섞인다. 그럴 바에는 곡선 전체를
  // 기준 수익률로 되돌리는 편이 정직하다.
  test('한 해라도 밴드가 비면 곡선 전체를 기준 수익률로 되돌린다', () => {
    const twoYears = [...result.yearlyResults, makeYearlyResult({ age: 61 })];

    const data = buildAssetChartData(twoYears, [], new Map(
      monteCarlo.assetBands.map((b) => [b.age, b])
    ));

    expect(data.usesMedian).toBe(false);
    expect(data.rows[0]['자산총액']).toBe(500000000);
  });

  test('어느 기준으로 그렸는지 범례에 적는다', () => {
    const { rerender } = renderChart();
    expect(screen.getByRole('button', { name: /총 자산액 \(중앙값\)/ })).toBeInTheDocument();

    rerender(
      <AssetGrowthChart
        params={params}
        result={result}
        compareResults={[]}
        hiddenKeys={{}}
        onLegendClick={() => {}}
        caption=""
        showBreakdown={false}
        onToggleBreakdown={() => {}}
        planOutcome={{ assetStatus: 'sustained', investableDepletionAge: null, spendingShortfall: null }}
      />
    );
    expect(screen.getByRole('button', { name: /총 자산액 \(기준 수익률\)/ })).toBeInTheDocument();
  });

  // 각 해의 중앙값은 서로 다른 시행에서 온다 — 이 곡선은 한 사람의 실제 경로가 아니다.
  test('중앙값 곡선의 한계를 문구로 밝힌다', () => {
    renderChart();

    expect(screen.getByText(/한 사람의 실제 경로가 아닙니다/)).toBeInTheDocument();
  });

  test('「나쁜 경우」 선은 더 이상 그리지 않는다', () => {
    renderChart();

    expect(screen.queryByRole('button', { name: /나쁜 경우/ })).not.toBeInTheDocument();
  });

  // 구성 계열(주식/연금/ISA/현금)은 기준 수익률 경로의 «분해»다. 중앙값 총액 아래에 두면
  // 부분의 합이 총액과 맞지 않는다. 그래서 상세보기에서는 총액도 기준 수익률로 되돌린다.
  test('자산 구성 상세에서는 총액도 기준 수익률로 되돌린다', () => {
    renderChart({ showBreakdown: true });

    expect(screen.getByRole('button', { name: /총 자산액 \(기준 수익률\)/ })).toBeInTheDocument();
    expect(screen.queryByText(/한 사람의 실제 경로가 아닙니다/)).not.toBeInTheDocument();
  });
});

import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetGrowthChart } from '@/web/features/Dashboard/charts/AssetGrowthChart';
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

// 몬테카를로 하방 선. 팬 차트 → 세 선(p10/p50/p90) → 한 선(p10)으로 두 번 줄었다.
// 팬 차트를 버린 것은 축이 P90에 끌려가서였고, 세 선을 한 선으로 줄인 것은 계열이 일곱 개가
// 되어 점선끼리 겹쳤기 때문이다. 남긴 것이 하방인 이유는 DOWNSIDE_SERIES 주석 참고.
describe('AssetGrowthChart - 몬테카를로 하방 선', () => {
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
    assetDownside: [{ age: 60, p10: 10000000 }],
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

  test('하방 선 하나만 범례 버튼으로 노출된다', () => {
    renderChart();

    expect(screen.getByRole('button', { name: /나쁜 경우 \(하위 10%\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /중간 경우/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /좋은 경우/ })).not.toBeInTheDocument();
  });

  // 범례 버튼의 aria-pressed가 곧 "지금 이 선이 보이는가"다.
  test('숨긴 하방 선은 버튼이 눌리지 않은 상태로 표시된다', () => {
    renderChart({ hiddenKeys: { '하위10%': true } });

    expect(screen.getByRole('button', { name: /나쁜 경우/ })).toHaveAttribute('aria-pressed', 'false');
  });

  test('하방 버튼을 누르면 그 dataKey로 토글이 올라간다', () => {
    const onLegendClick = vi.fn();
    renderChart({ onLegendClick });

    fireEvent.click(screen.getByRole('button', { name: /나쁜 경우/ }));

    expect(onLegendClick).toHaveBeenCalledTimes(1);
    expect(onLegendClick.mock.calls[0][0]).toMatchObject({ dataKey: '하위10%' });
  });

  // 사용자가 두 곡선 사이 간격을 오차범위로 읽으면 실제 하방폭을 과소평가한다 —
  // 결정론 곡선은 중앙값보다 높기 때문이다. 그 사실을 문구로 밝힌다.
  test('하방 선의 의미와 주 곡선의 가정을 문구로 밝힌다', () => {
    renderChart();

    expect(screen.getByText(/한 사람의 실제 경로가 아닙니다/)).toBeInTheDocument();
    expect(screen.getByText(/실제 중앙값보다 높습니다/)).toBeInTheDocument();
  });

  // 구성 상세를 펼치면 시리즈가 일곱 개가 되어 어느 것도 읽히지 않는다.
  test('자산 구성 상세를 펼치면 하방 선을 그리지 않는다', () => {
    renderChart({ showBreakdown: true });

    expect(screen.queryByRole('button', { name: /나쁜 경우/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/한 사람의 실제 경로가 아닙니다/)).not.toBeInTheDocument();
  });

  // MC가 아직 안 끝났거나(워커 지연) 미지원 환경이면 나머지 차트는 그대로 그려져야 한다.
  test('몬테카를로 결과가 없으면 하방 범례를 만들지 않는다', () => {
    renderChart({ monteCarlo: undefined });

    expect(screen.queryByRole('button', { name: /나쁜 경우/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /총 자산액/ })).toBeInTheDocument();
  });
});

import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetGrowthChart, DEFAULT_HIDDEN_PERCENTILE_KEYS } from '@/web/features/Dashboard/charts/AssetGrowthChart';
import { MonteCarloResult } from '@/core/entities/montecarlo';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';
import { makeYearlyResult as sharedYearlyResult } from '@/tests/fixtures/yearlyResult';

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

// 몬테카를로 분위수 선. 처음에는 p10~p90을 채운 팬 차트였는데, 39년 뒤 상위 10%가 80억까지
// 벌어지면서 축이 그쪽에 끌려가 정작 봐야 할 결정론 곡선과 중앙값이 바닥에 눌렸다.
// 지금은 세 선을 각각 범례 버튼으로 켜고 끈다(PERCENTILE_SERIES 주석 참고).
describe('AssetGrowthChart - 몬테카를로 분위수 선', () => {
  const monteCarlo: MonteCarloResult = {
    trials: 1000,
    seed: 1,
    successAge: 90,
    successRate: 0.39,
    spendingSuccessRate: 0.39,
    plannedMonthlySpending: 2230000,
    endingAssets: { p10: 0, p50: 100000000, p90: 8000000000, mean: 500000000 },
    assetBand: [{ age: 60, p10: 10000000, p50: 300000000, p90: 900000000 }],
    depletion: { count: 610, earliestAge: 72, medianAge: 84 },
    deterministicEndingAssets: 500000000,
    worstDecilePath: [],
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

  test('세 분위수가 각각 범례 버튼으로 노출된다', () => {
    renderChart();

    expect(screen.getByRole('button', { name: /나쁜 경우 \(하위 10%\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /중간 경우 \(중앙값\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /좋은 경우 \(상위 10%\)/ })).toBeInTheDocument();
  });

  // 범례 버튼의 aria-pressed가 곧 "지금 이 선이 보이는가"다.
  test('숨겨진 분위수는 버튼이 눌리지 않은 상태로 표시된다', () => {
    renderChart({ hiddenKeys: { '상위10%': true } });

    expect(screen.getByRole('button', { name: /좋은 경우/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /나쁜 경우/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('분위수 버튼을 누르면 그 dataKey로 토글이 올라간다', () => {
    const onLegendClick = vi.fn();
    renderChart({ onLegendClick });

    fireEvent.click(screen.getByRole('button', { name: /좋은 경우/ }));

    expect(onLegendClick).toHaveBeenCalledTimes(1);
    expect(onLegendClick.mock.calls[0][0]).toMatchObject({ dataKey: '상위10%' });
  });

  // 구성 상세를 펼치면 시리즈가 아홉 개가 되어 어느 것도 읽히지 않는다.
  test('자산 구성 상세를 펼치면 분위수 선을 그리지 않는다', () => {
    renderChart({ showBreakdown: true });

    expect(screen.queryByRole('button', { name: /나쁜 경우/ })).not.toBeInTheDocument();
  });

  // MC가 아직 안 끝났거나(워커 지연) 미지원 환경이면 나머지 차트는 그대로 그려져야 한다.
  test('몬테카를로 결과가 없으면 분위수 범례를 만들지 않는다', () => {
    renderChart({ monteCarlo: undefined });

    expect(screen.queryByRole('button', { name: /중간 경우/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /총 자산액/ })).toBeInTheDocument();
  });
});

// 상위 10%를 기본으로 꺼 두는 것은 축이 그 선에 끌려가기 때문이다. 나머지 둘은 켜 둔다 —
// 은퇴 계획에서 봐야 할 것은 상방이 아니라 하방이다.
describe('DEFAULT_HIDDEN_PERCENTILE_KEYS', () => {
  test('상위 10%만 기본으로 숨긴다', () => {
    expect(DEFAULT_HIDDEN_PERCENTILE_KEYS['상위10%']).toBe(true);
    expect(DEFAULT_HIDDEN_PERCENTILE_KEYS['하위10%']).toBeUndefined();
    expect(DEFAULT_HIDDEN_PERCENTILE_KEYS['중앙값']).toBeUndefined();
  });
});

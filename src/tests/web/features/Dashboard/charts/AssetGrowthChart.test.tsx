import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetGrowthChart } from '@/web/features/Dashboard/charts/AssetGrowthChart';
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
  householdEndAge: 90,
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
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '자산 구성 상세보기' }));
    expect(onToggleBreakdown).toHaveBeenCalledTimes(1);
  });
});

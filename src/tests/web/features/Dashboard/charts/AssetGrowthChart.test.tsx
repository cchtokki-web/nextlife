import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetGrowthChart } from '@/web/features/Dashboard/charts/AssetGrowthChart';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';

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
    spouseAlive: false,
    ...overrides,
  };
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

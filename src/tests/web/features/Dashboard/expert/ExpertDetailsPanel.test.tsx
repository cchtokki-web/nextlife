import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpertDetailsPanel } from '@/web/features/Dashboard/expert/ExpertDetailsPanel';
import { SimulationParams, SimulationResult, SimulationYearlyResult, UtilityBreakdown } from '@/core/entities/types';

function makeYearlyResult(overrides: Partial<SimulationYearlyResult>): SimulationYearlyResult {
  return {
    age: 60,
    year: 2026,
    totalAssets: 0,
    stockAssets: 0,
    pensionAssets: 0,
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
    spending: 0,
    hasTaxWarning: false,
    ...overrides,
  };
}

const result: SimulationResult = {
  yearlyResults: [makeYearlyResult({ age: 65, nationalPensionIncome: 12000000 })],
  fireAge: 60,
  depletionAge: null,
  endingAssets: 0,
  retirementScore: 0,
  retirementGrade: '보통',
  goalAchievementRate: 100,
  retirementAssetsAtRetirement: 0,
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

const utility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0 },
};

const formatValue = (v: number) => `${v.toLocaleString()}원`;

describe('ExpertDetailsPanel', () => {
  test('기본적으로 닫혀 있고, 열면 세금/연금 리스크 섹션이 보인다', () => {
    render(
      <ExpertDetailsPanel result={result} params={params} utility={utility} formatValue={formatValue} isPro={false} />
    );

    expect(screen.queryByText('세금 및 건강보험료 (은퇴 이후 연평균)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));

    expect(screen.getByText('세금 및 건강보험료 (은퇴 이후 연평균)')).toBeInTheDocument();
    expect(screen.getByText(/65세부터 수령/)).toBeInTheDocument();
    expect(screen.getByText('장점')).toBeInTheDocument();
  });

  test('isPro가 false이면 연도별 상세 내역(YearlyChart) 섹션을 렌더링하지 않는다', () => {
    render(
      <ExpertDetailsPanel result={result} params={params} utility={utility} formatValue={formatValue} isPro={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));
    expect(screen.queryByText('연도별 상세 내역')).not.toBeInTheDocument();
  });

  test('isPro가 true이면 연도별 상세 내역(YearlyChart) 섹션을 렌더링한다', () => {
    render(
      <ExpertDetailsPanel result={result} params={params} utility={utility} formatValue={formatValue} isPro={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));
    expect(screen.getByText('연도별 상세 내역')).toBeInTheDocument();
  });
});

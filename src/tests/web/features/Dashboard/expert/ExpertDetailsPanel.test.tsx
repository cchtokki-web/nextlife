import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpertDetailsPanel } from '@/web/features/Dashboard/expert/ExpertDetailsPanel';
import { SimulationParams, SimulationResult } from '@/core/entities/types';
import { makeYearlyResult as makeYearlyResultFixture } from '@/tests/fixtures/yearlyResult';

// 기본값이 공용 픽스처와 완전히 같았다(복제본을 없애려고 그 픽스처를 만들었다).
const makeYearlyResult = makeYearlyResultFixture;

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

const formatValue = (v: number) => `${v.toLocaleString()}원`;

describe('ExpertDetailsPanel', () => {
  test('기본적으로 닫혀 있고, 열면 세금/연금 리스크 섹션이 보인다', () => {
    render(<ExpertDetailsPanel result={result} params={params} formatValue={formatValue} isPro={false} />);

    expect(screen.queryByText('세금 및 건강보험료 (은퇴 이후 연평균)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));

    expect(screen.getByText('세금 및 건강보험료 (은퇴 이후 연평균)')).toBeInTheDocument();
    expect(screen.getByText(/65세부터 수령/)).toBeInTheDocument();
  });

  test('isPro가 false이면 연도별 상세 내역(YearlyChart) 섹션을 렌더링하지 않는다', () => {
    render(<ExpertDetailsPanel result={result} params={params} formatValue={formatValue} isPro={false} />);
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));
    expect(screen.queryByText('연도별 상세 내역')).not.toBeInTheDocument();
  });

  test('isPro가 true이면 연도별 상세 내역(YearlyChart) 섹션을 렌더링한다', () => {
    render(<ExpertDetailsPanel result={result} params={params} formatValue={formatValue} isPro={true} />);
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));
    expect(screen.getByText('연도별 상세 내역')).toBeInTheDocument();
  });

  test('국민연금이 전혀 없으면 "65세부터 수령"이 아니라 "국민연금 없이" 문구를 보여준다', () => {
    const noNationalPensionResult: SimulationResult = {
      ...result,
      yearlyResults: [makeYearlyResult({ age: 65, nationalPensionIncome: 0 })],
    };
    const noNationalPensionParams: SimulationParams = { ...params, nationalPension: { expectedMonthlyAmount: 0 } };

    render(
      <ExpertDetailsPanel
        result={noNationalPensionResult}
        params={noNationalPensionParams}
        formatValue={formatValue}
        isPro={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));

    expect(screen.getByText('국민연금 없이 사적연금·배당·기타소득으로 생활비를 충당합니다.')).toBeInTheDocument();
    expect(screen.queryByText(/65세부터 수령/)).not.toBeInTheDocument();
  });

  // 투자자산이 있어야 수익률 시나리오가 baseline과 다른 결과를 낸다 — 자산이 없으면
  // 6개 시나리오가 전부 동일해져 그 행들이 의도적으로 접힌다(SensitivityAnalysisSection).
  const paramsWithAssets: SimulationParams = {
    ...params,
    assets: [
      {
        id: 'a1', type: 'etf', ticker: 'KODEX', name: '국내 ETF', quantity: 10000,
        averagePrice: 100000, annualGrowthRate: 6, dividendYield: 2,
        monthlyContribution: 0, reinvestDividend: false, currency: 'KRW',
      },
    ],
  };

  test('민감도 분석 섹션(SensitivityAnalysisSection)이 렌더된다', () => {
    render(<ExpertDetailsPanel result={result} params={paramsWithAssets} formatValue={formatValue} isPro={false} />);
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));

    // 제목이 "자산 고갈 나이"에서 바뀐 이유: 고갈이 없는 계획에서도 기말자산으로
    // 시나리오를 구분해 보여주게 되어, 고갈 나이는 여러 지표 중 하나가 되었다.
    expect(screen.getByText('민감도 분석 (핵심 가정 변화에 따른 영향)')).toBeInTheDocument();
    expect(screen.getByText('투자수익률 -2%p')).toBeInTheDocument();
    expect(screen.getByText('은퇴시점 +3년')).toBeInTheDocument();
  });

  // 국민연금만 등록한 계획: 수익률·물가를 흔들어도 굴릴 원금이 없어 결과가 전부 같다.
  // 예전에는 6행이 "0원 · 51세 고갈 · 생활비 부족 N년"으로 똑같이 찍혔다.
  test('투자자산이 없으면 결과가 동일한 시나리오를 접고 그 이유를 밝힌다', () => {
    render(<ExpertDetailsPanel result={result} params={params} formatValue={formatValue} isPro={false} />);
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));

    expect(screen.getByText(/투자자산이 없어/)).toBeInTheDocument();
    expect(screen.queryByText('투자수익률 -2%p')).not.toBeInTheDocument();
  });

  test('민감도 분석 기준선은 result prop이 아니라 params로 직접 재계산한 값을 사용한다 (Before/After 토글과 무관)', () => {
    const misleadingResult: SimulationResult = { ...result, depletionAge: 999 }; // 실제로는 나올 수 없는 값 — result를 그대로 믿으면 999세가 표시됨
    render(<ExpertDetailsPanel result={misleadingResult} params={params} formatValue={formatValue} isPro={false} />);
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));
    expect(screen.queryByText(/999세/)).not.toBeInTheDocument();
  });
});

// 경고 카드(computeRiskAlerts)는 부과 기준 소득이 문턱의 90~110%일 때만 뜬다. 이미 크게
// 넘어선 사용자는 그 카드를 못 보므로, 전문가 패널에서는 조건 없이 금액을 보여준다.
describe('ExpertDetailsPanel - 피부양자 자격 상실 시 건강보험료', () => {
  const overThresholdResult: SimulationResult = {
    ...result,
    yearlyResults: [
      makeYearlyResult({ age: 65, healthInsuranceIncomeBasis: 25000000 }),
      makeYearlyResult({ age: 70, healthInsuranceIncomeBasis: 40000000 }),
    ],
  };

  test('부과 기준 소득이 문턱을 넘으면 자격 상실 시 보험료를 함께 보여준다', () => {
    render(<ExpertDetailsPanel result={overThresholdResult} params={params} formatValue={formatValue} isPro={false} />);
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));

    expect(screen.getByText(/피부양자 자격 상실 시/)).toBeInTheDocument();
    expect(screen.getByText(/70세/)).toBeInTheDocument();
  });

  test('재산·자동차분이 빠져 있다는 사실을 함께 밝힌다', () => {
    render(<ExpertDetailsPanel result={overThresholdResult} params={params} formatValue={formatValue} isPro={false} />);
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));

    expect(screen.getByText(/재산·자동차분/)).toBeInTheDocument();
  });

  test('문턱을 넘는 해가 없으면 아무것도 보여주지 않는다', () => {
    render(<ExpertDetailsPanel result={result} params={params} formatValue={formatValue} isPro={false} />);
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));

    expect(screen.queryByText(/피부양자 자격 상실 시/)).not.toBeInTheDocument();
  });
});

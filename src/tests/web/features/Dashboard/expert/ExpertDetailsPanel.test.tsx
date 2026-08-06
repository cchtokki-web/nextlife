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

  test('민감도 분석 섹션(SensitivityAnalysisSection)이 렌더된다', () => {
    render(<ExpertDetailsPanel result={result} params={params} formatValue={formatValue} isPro={false} />);
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));

    // 제목이 "자산 고갈 나이"에서 바뀐 이유: 고갈이 없는 계획에서도 기말자산으로
    // 시나리오를 구분해 보여주게 되어, 고갈 나이는 여러 지표 중 하나가 되었다.
    expect(screen.getByText('민감도 분석 (핵심 가정 변화에 따른 영향)')).toBeInTheDocument();
    expect(screen.getByText('투자수익률 -2%p')).toBeInTheDocument();
    expect(screen.getByText('은퇴시점 +3년')).toBeInTheDocument();
  });

  test('민감도 분석 기준선은 result prop이 아니라 params로 직접 재계산한 값을 사용한다 (Before/After 토글과 무관)', () => {
    const misleadingResult: SimulationResult = { ...result, depletionAge: 999 }; // 실제로는 나올 수 없는 값 — result를 그대로 믿으면 999세가 표시됨
    render(<ExpertDetailsPanel result={misleadingResult} params={params} formatValue={formatValue} isPro={false} />);
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));
    expect(screen.queryByText(/999세/)).not.toBeInTheDocument();
  });
});

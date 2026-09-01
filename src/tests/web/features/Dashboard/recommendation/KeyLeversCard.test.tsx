import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyLeversCard } from '@/web/features/Dashboard/recommendation/KeyLeversCard';
import { computeKeyLevers, KeyLeversInput } from '@/core/usecases/dashboard/computeKeyLevers';
import { SensitivityAnalysis, SensitivityScenario } from '@/core/usecases/dashboard/computeSensitivityAnalysis';

// KeyLeversCard 자체는 lever.title/lever.detail을 그대로 찍는 얇은 컴포넌트다. 여기서
// 확인하는 것은 그 사실이 아니라, computeKeyLevers가 만든 HARD 위반 문구가 이 컴포넌트를
// 거치는 동안 잘리거나 escape되지 않고 화면에 그대로 도달하는가다 — pdfReportSections의
// renderKeyLeversSection과 나란히 "같은 core 출력이 두 렌더 표면 모두에 살아 있는가"를
// 검증하는 두 테스트 중 하나다.

const won = (v: number) => `${Math.round(v / 10000).toLocaleString()}만원`;

function scenario(
  key: SensitivityScenario['key'],
  overrides: Partial<SensitivityScenario> = {}
): SensitivityScenario {
  return {
    key, label: key, depletionAge: null, deltaYears: null,
    endingAssets: 0, endingAssetsDelta: 0, unmetSpendingYears: 0, hardViolations: [],
    ...overrides,
  };
}

function sensitivity(
  scenarios: SensitivityScenario[],
  hardRequirementGoals: SensitivityAnalysis['hardRequirementGoals']
): SensitivityAnalysis {
  return {
    scenarios,
    frozenMonthlySpending: 2230000,
    baselineDepletionAge: null,
    baselineEndingAssets: 13960000,
    baselineUnmetSpendingYears: 0,
    baselineHardViolations: [],
    hardRequirementGoals,
    baselinePlanAssetStatus: 'sustained',
    baselineWeightedTotalReturn: 12,
  };
}

describe('KeyLeversCard', () => {
  test('레버가 없으면 아무것도 렌더하지 않는다', () => {
    const { container } = render(<KeyLeversCard levers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  // **이 테스트가 리뷰가 지목한 결함의 화면 쪽 재현이다.** depletionAge도
  // unmetSpendingYears도 없는 terminalAsset 단독 위반은, 위반 판정이 없다면 "기대수명 시점
  // 자산 +N원"이라는 순수 개선 문구로만 카드 1순위(은퇴 시점 조정)에 올라간다. 이 카드
  // 바로 아래 SensitivityAnalysisSection이 같은 시나리오를 위반으로 표시하는데, 이 카드가
  // 반영하지 않으면 한 페이지가 스스로 모순된다.
  test('HARD 위반 시나리오는 카드에서도 「반드시 지키기」 위반으로 드러난다', () => {
    const input: KeyLeversInput = {
      sensitivity: sensitivity(
        [
          scenario('retirementLater', { endingAssetsDelta: 1083600000, hardViolations: ['terminalAsset'] }),
          scenario('retirementEarlier', { depletionAge: 61, unmetSpendingYears: 19 }),
        ],
        { spendingTarget: [], assetSurvival: [], terminalAsset: ['INHERITANCE'] },
      ),
      pensionGap: null,
      shortfall: { goal: null, plan: null, goalMonthlySpending: 3500000, sustainableMonthlySpending: 3500000 },
      recommendation: undefined,
      formatValue: won,
    };
    const levers = computeKeyLevers(input);

    render(<KeyLeversCard levers={levers} />);

    // 근거 문장도 같은 「반드시 지키기」 문구를 담으므로, 위반 라벨 자체는 특정
    // 텍스트("상속 자산 확보")로만 확인한다 — 개수·근거 문장 자리는 아래 두 테스트가 본다.
    expect(screen.getByText('은퇴 시점 조정')).toBeInTheDocument();
    expect(screen.getByText(/상속 자산 확보/)).toBeInTheDocument();
  });

  test('위반이 없으면 위반 문구도 판정 근거 문장도 렌더하지 않는다', () => {
    const input: KeyLeversInput = {
      sensitivity: sensitivity(
        [
          scenario('retirementLater', { endingAssetsDelta: 1083600000 }),
          scenario('retirementEarlier', { depletionAge: 61, unmetSpendingYears: 19 }),
        ],
        { spendingTarget: [], assetSurvival: [], terminalAsset: [] },
      ),
      pensionGap: null,
      shortfall: { goal: null, plan: null, goalMonthlySpending: 3500000, sustainableMonthlySpending: 3500000 },
      recommendation: undefined,
      formatValue: won,
    };
    const levers = computeKeyLevers(input);

    render(<KeyLeversCard levers={levers} />);

    expect(screen.queryByText(/반드시 지키기/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('key-levers-hard-violation-basis')).not.toBeInTheDocument();
  });

  // **이 테스트가 리뷰 재지적의 요점이다.** 판정 근거("결정론으로 1회 실행한 판정")를 레버
  // 마다 붙이면, 은퇴 시점·투자수익률 레버가 둘 다 위반을 담을 때 카드 하나에 같은 문장이
  // 두 번 찍힌다. 근거는 카드 전체에 «한 번만» 나야 한다.
  test('두 레버가 모두 위반해도 판정 근거 문장은 카드에 한 번만 나온다', () => {
    const goals: SensitivityAnalysis['hardRequirementGoals'] = {
      spendingTarget: [], assetSurvival: [], terminalAsset: ['INHERITANCE'],
    };
    const input: KeyLeversInput = {
      sensitivity: sensitivity(
        [
          scenario('retirementLater', { endingAssetsDelta: 1083600000, hardViolations: ['terminalAsset'] }),
          scenario('retirementEarlier', { depletionAge: 61, unmetSpendingYears: 19 }),
          scenario('yieldAggressive', { endingAssetsDelta: 499010000, hardViolations: ['terminalAsset'] }),
          scenario('yieldConservative', { depletionAge: 67, unmetSpendingYears: 13 }),
        ],
        goals,
      ),
      pensionGap: null,
      shortfall: { goal: null, plan: null, goalMonthlySpending: 3500000, sustainableMonthlySpending: 3500000 },
      recommendation: undefined,
      formatValue: won,
    };
    const levers = computeKeyLevers(input);
    expect(levers.filter((l) => l.hardViolation)).toHaveLength(2); // 전제: 두 레버 모두 위반

    render(<KeyLeversCard levers={levers} />);

    // 위반 라벨("상속 자산 확보")은 레버 두 곳에 있어야 한다.
    expect(screen.getAllByText(/상속 자산 확보/)).toHaveLength(2);
    // 근거 문장은 정확히 한 번이다.
    expect(screen.getAllByTestId('key-levers-hard-violation-basis')).toHaveLength(1);
  });
});

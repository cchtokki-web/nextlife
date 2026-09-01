import { describe, test, expect } from 'vitest';
import { computeKeyLevers, KeyLeversInput } from '@/core/usecases/dashboard/computeKeyLevers';
import { SensitivityAnalysis, SensitivityScenario } from '@/core/usecases/dashboard/computeSensitivityAnalysis';
import { ShortfallReport } from '@/core/usecases/dashboard/computeShortfallSummary';
import { StrategyRecommendation } from '@/core/entities/types';

const won = (v: number) => `${Math.round(v / 10000).toLocaleString()}만원`;

const scenario = (
  key: SensitivityScenario['key'],
  overrides: Partial<SensitivityScenario> = {}
): SensitivityScenario => ({
  key,
  label: key,
  depletionAge: null,
  deltaYears: null,
  endingAssets: 0,
  endingAssetsDelta: 0,
  unmetSpendingYears: 0,
  hardViolations: [],
  ...overrides,
});

const sensitivity = (scenarios: SensitivityScenario[]): SensitivityAnalysis => ({
  scenarios,
  frozenMonthlySpending: 2230000,
  baselineDepletionAge: null,
  baselineEndingAssets: 13960000,
  baselineUnmetSpendingYears: 0,
  baselineHardViolations: [],
  hardRequirementGoals: { spendingTarget: [], assetSurvival: [], terminalAsset: [] },
  baselinePlanAssetStatus: 'sustained',
  baselineWeightedTotalReturn: 12,
});

const shortfall = (overrides: Partial<ShortfallReport> = {}): ShortfallReport => ({
  goal: {
    shortfallYears: 31,
    firstShortfallAge: 60,
    lastShortfallAge: 90,
    averageMonthlyShortfall: 1260000,
    totalShortfallInTodayValue: 468730000,
  },
  plan: null,
  goalMonthlySpending: 3500000,
  sustainableMonthlySpending: 2230000,
  ...overrides,
});

const input = (overrides: Partial<KeyLeversInput> = {}): KeyLeversInput => ({
  sensitivity: sensitivity([
    scenario('retirementLater', { endingAssetsDelta: 1083600000 }),
    scenario('retirementEarlier', { depletionAge: 61, unmetSpendingYears: 19 }),
    scenario('yieldAggressive', { endingAssetsDelta: 499010000 }),
    scenario('yieldConservative', { depletionAge: 67, unmetSpendingYears: 13 }),
  ]),
  pensionGap: {
    fromAge: 60, toAge: 64, years: 5,
    monthlyAssetWithdrawal: 2500000, assetWithdrawalAmount: 150000000,
    shortfallYears: 0, averageMonthlyShortfall: 0, shortfallAmount: 0,
    bridgeAmount: 150000000,
  },
  shortfall: shortfall(),
  recommendation: undefined,
  formatValue: won,
  ...overrides,
});

describe('computeKeyLevers', () => {
  // **순서가 이 함수의 핵심이다.** 금액으로 정렬하면 수익률 ±2%p가 늘 1위가 되는데, 그것은
  // 사용자가 통제할 수 없는 변수다. 통제 가능성과 확실성 순으로 고정한다.
  test('통제 가능성 순으로 고정된 순서를 낸다', () => {
    expect(computeKeyLevers(input()).map((l) => l.key)).toEqual([
      'retirementAge',
      'pensionBridge',
      'targetSpending',
      'investmentReturn',
    ]);
  });

  // 인출 순서는 마지막이다. 예전에는 이것이 「실행 계획」의 첫 카드였고, 실제 리포트에서
  // AI 추천이 "배당수익률이 낮은 자산부터 매도" 한 줄로 끝난 이유가 그 배치였다.
  const zeroDeltas = {
    totalTax: 0, endingAssets: 0, lifetimeConsumption: 0, pensionEndingBalance: 0,
    comprehensiveTaxYears: 0, healthInsuranceTotal: 0, nationalPensionTotal: 0,
  };
  const withdrawalRecommendation = (
    deltas: Partial<typeof zeroDeltas>
  ) => ({
    improved: true,
    itemizedContributions: [
      {
        field: 'assetSellOrderStrategy',
        label: '배당수익률이 낮은 자산부터 매도합니다.',
        utilityDelta: 7,
        deltas: { ...zeroDeltas, ...deltas },
      },
    ],
  }) as unknown as StrategyRecommendation;

  test('인출 순서 레버는 추천이 있을 때 맨 마지막에 붙는다', () => {
    const levers = computeKeyLevers(
      input({ recommendation: withdrawalRecommendation({ totalTax: -3_000_000 }) })
    );

    expect(levers[levers.length - 1].key).toBe('withdrawalOrder');
    expect(levers[levers.length - 1].detail).toContain('배당수익률이 낮은 자산부터 매도합니다.');
  });

  // 평생 효용은 후보를 서로 비교하기 위한 내부 척도라 사용자가 "+7점"의 크기를 가늠할 기준이
  // 없고, 결과 화면에서도 더 이상 노출하지 않는다. 근거는 다른 레버와 같은 자(금액)로 말한다.
  test('인출 순서 레버는 효용 점수가 아니라 절세·자산 금액을 근거로 말한다', () => {
    const levers = computeKeyLevers(
      input({ recommendation: withdrawalRecommendation({ totalTax: -3_000_000, endingAssets: 12_000_000 }) })
    );
    const detail = levers[levers.length - 1].detail;

    expect(detail).not.toContain('효용');
    expect(detail).not.toContain('체크리스트');
    expect(detail).toContain('절세');
    expect(detail).toContain('기말자산');
  });

  // 금액 효과가 전혀 없는 항목은 "라벨만 있는 5순위"로 남아 목록의 신뢰도만 떨어뜨린다.
  test('금액 근거가 하나도 없으면 인출 순서 레버를 만들지 않는다', () => {
    const levers = computeKeyLevers(input({ recommendation: withdrawalRecommendation({}) }));

    expect(levers.some((lever) => lever.key === 'withdrawalOrder')).toBe(false);
  });

  // 근거 없는 항목은 배열에 넣지 않는다 — 지어낸 조언은 이 저장소가 이미 거부한 형태다.
  test('근거가 없는 레버는 제외한다', () => {
    const levers = computeKeyLevers(
      input({
        pensionGap: null,
        // 목표와 지속가능액이 같으면 조정할 것이 없다.
        shortfall: shortfall({ goal: null, goalMonthlySpending: 2230000 }),
        sensitivity: sensitivity([]),
      })
    );

    expect(levers).toEqual([]);
  });

  // 사용자가 "왜 +3년이 +10억인가"를 계산 오류로 읽지 않도록 근거를 함께 말한다.
  test('은퇴 시점 레버는 양방향 결과와 그 이유를 함께 말한다', () => {
    const [retirement] = computeKeyLevers(input());

    expect(retirement.detail).toContain('3년 늦추면');
    expect(retirement.detail).toContain('3년 앞당기면 61세 자산 고갈');
    expect(retirement.detail).toContain('추가 적립');
  });

  // 수익률은 «정하는» 것이 아니라 «기대하는» 것이다. 그 구분이 없으면 "수익률을 2%p
  // 올리세요"라는 실행 불가능한 조언으로 읽힌다.
  test('수익률 레버는 통제할 수 없는 변수임을 밝힌다', () => {
    const lever = computeKeyLevers(input()).find((l) => l.key === 'investmentReturn')!;

    expect(lever.detail).toContain('정할 수 있는 값이 아니라');
  });

  test('연금 공백 레버는 Bridge 자금 금액을 인용한다', () => {
    const lever = computeKeyLevers(input()).find((l) => l.key === 'pensionBridge')!;

    expect(lever.title).toContain('60~64세');
    expect(lever.detail).toContain(won(150000000));
  });
});

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

const sensitivity = (
  scenarios: SensitivityScenario[],
  hardRequirementGoals: SensitivityAnalysis['hardRequirementGoals'] = { spendingTarget: [], assetSurvival: [], terminalAsset: [] },
): SensitivityAnalysis => ({
  scenarios,
  frozenMonthlySpending: 2230000,
  baselineDepletionAge: null,
  baselineEndingAssets: 13960000,
  baselineUnmetSpendingYears: 0,
  baselineHardViolations: [],
  hardRequirementGoals,
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

  // **이 스위트가 리뷰가 지목한 결함의 근거다.** describeScenario는 depletionAge·
  // unmetSpendingYears가 있으면 그 값으로 위험을 알렸지만, terminalAsset(기말자산 하한)
  // 단독 위반은 둘 다 없다 — 세 번째 branch(기대수명 시점 자산 +N원)로 떨어져 순수 개선
  // 문구만 남았다. 그 시나리오가 「무엇부터 바꿔야 하나」 카드의 1순위(retirementAge, 순서
  // 고정)에 오르면, 카드는 HARD 위반 시나리오를 최우선 개선안으로 제시하게 된다.
  describe('HARD 목표 위반이 레버 문구에 반영된다', () => {
    // hardRequirementGoals가 채워져 있어야 위반 축을 목표 이름으로 옮길 수 있다.
    const terminalAssetGoals: SensitivityAnalysis['hardRequirementGoals'] = {
      spendingTarget: [], assetSurvival: [], terminalAsset: ['INHERITANCE'],
    };

    test('depletionAge도 unmetSpendingYears도 없는 terminalAsset 단독 위반이 은퇴 시점 레버에 드러난다', () => {
      const levers = computeKeyLevers(input({
        sensitivity: sensitivity(
          [
            // depletionAge: null, unmetSpendingYears: 0(기본값) — 원래 코드의 첫 두 branch로는
            // 절대 잡히지 않는, 「순수 개선처럼 보이는」 값 그대로다.
            scenario('retirementLater', { endingAssetsDelta: 1083600000, hardViolations: ['terminalAsset'] }),
            scenario('retirementEarlier', { depletionAge: 61, unmetSpendingYears: 19 }),
          ],
          terminalAssetGoals,
        ),
      }));

      const retirement = levers.find((l) => l.key === 'retirementAge')!;
      // 위반이 반영되지 않았다면 이 문구는 "3년 늦추면 기대수명 시점 자산 +108,360만원"처럼
      // 순수 개선으로만 읽혔을 것이다.
      expect(retirement.detail).toContain('반드시 지키기');
      expect(retirement.detail).toContain('상속 자산 확보');
      // 판정 근거(결정론 1회 실행)는 이 문구 안에 있지 않다 — 레버마다 반복하면 위반이 넓게
      // 퍼진 계획에서 카드 하나에 같은 문장이 여러 번 찍힌다(리뷰 지적). 그 문장은 hardViolation
      // 플래그를 본 렌더 표면(KeyLeversCard·renderKeyLeversSection)이 카드당 한 번만 낸다.
      expect(retirement.detail).not.toContain('결정론');
      expect(retirement.hardViolation).toBe(true);
    });

    // 위반이 없는 값(기존 픽스처)은 문구·플래그가 그대로여야 한다 — 위반 판정을 덧붙이는
    // 변경이 위반 없는 시나리오의 기존 출력까지 건드리면 그 자체가 회귀다.
    test('위반이 없으면 기존 문구 그대로고 hardViolation도 서지 않는다(회귀)', () => {
      const [retirement] = computeKeyLevers(input());

      expect(retirement.detail).not.toContain('반드시 지키기');
      expect(retirement.detail).not.toContain('결정론');
      expect(retirement.hardViolation).toBeFalsy();
    });

    // 순서는 여전히 고정이다 — 위반이 있다고 해서 그 레버가 뒤로 밀리거나 앞으로 당겨지지
    // 않는다(computeKeyLevers의 LEVER_ORDER 주석: "영향 크기로 정렬하지 않는다"). 위반의
    // 유무가 «순서»가 아니라 «문구»에서만 드러나야 한다는 것을 이 assertion이 고정한다.
    test('위반이 있어도 레버 순서는 바뀌지 않는다', () => {
      const levers = computeKeyLevers(input({
        sensitivity: sensitivity(
          [
            scenario('retirementLater', { endingAssetsDelta: 1083600000, hardViolations: ['terminalAsset'] }),
            scenario('retirementEarlier', { depletionAge: 61, unmetSpendingYears: 19 }),
          ],
          terminalAssetGoals,
        ),
      }));

      // 이 픽스처는 은퇴시점 시나리오만 두므로 investmentReturn 레버는 애초에 만들어지지
      // 않는다(buildInvestmentReturnLever가 yieldAggressive/yieldConservative를 못 찾음) —
      // 이 테스트가 확인하는 것은 «만들어진 레버들의 순서»이지 레버 목록 자체가 아니다.
      expect(levers.map((l) => l.key)).toEqual([
        'retirementAge', 'pensionBridge', 'targetSpending',
      ]);
    });

    // 투자수익률 레버(양방향 시나리오를 함께 말하는 두 번째 소비처)도 같은 함수를 쓴다는 것을
    // 확인한다 — describeScenario를 한 곳에서만 고치고 investmentReturn 레버에서 다시 쓰는
    // 것을 잊으면 이 테스트가 잡는다.
    test('투자 포트폴리오 레버도 같은 위반 문구를 쓴다', () => {
      const levers = computeKeyLevers(input({
        sensitivity: sensitivity(
          [
            scenario('yieldAggressive', { endingAssetsDelta: 499010000, hardViolations: ['terminalAsset'] }),
            scenario('yieldConservative', { depletionAge: 67, unmetSpendingYears: 13 }),
          ],
          terminalAssetGoals,
        ),
      }));

      const investment = levers.find((l) => l.key === 'investmentReturn')!;
      expect(investment.detail).toContain('반드시 지키기');
      expect(investment.detail).toContain('상속 자산 확보');
      expect(investment.hardViolation).toBe(true);
    });
  });
});

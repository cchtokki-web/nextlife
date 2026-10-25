import { describe, test, expect, vi } from 'vitest';
import { computeSensitivityAnalysis } from '@/core/usecases/dashboard/computeSensitivityAnalysis';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';
import { YIELD_PRESET_RATES } from '@/core/usecases/scenario/applyYieldPreset';
import { freezeSpendingPlan, runFrozenPlan, mapFrozenPlan } from '@/core/usecases/spending/freezeSpendingPlan';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 40, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [
    { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 10, averagePrice: 400000,
      totalReturn: 7, dividendYield: 1.5, monthlyContribution: 500000, reinvestDividend: true, currency: 'KRW' },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 50000000, monthlyContribution: 300000, totalReturn: 4, currency: 'KRW' },
  ],
  isaAccounts: [
    { id: 'i1', type: 'general', balance: 20000000, monthlyContribution: 200000,
      totalReturn: 5, dividendYield: 2, currency: 'KRW', maturityYears: 3 },
  ],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

// 구현이 유도하는 폭과 «같은 숫자»를 여기 적어 둔다. 구현에서 import하면 폭이 바뀌는 날
// 테스트가 함께 따라가 아무것도 검사하지 않게 된다 — 아래 「프리셋 표의 간격에서 온다」가
// 그 두 값이 어긋나지 않는지 따로 확인한다.
const YIELD_SHIFT = 2;

function makeResult(
  depletionAge: number | null,
  extras: { endingAssets?: number; yearlyResults?: SimulationYearlyResult[] } = {}
): SimulationResult {
  return {
    yearlyResults: extras.yearlyResults ?? [],
    fireAge: 60,
    depletionAge,
    endingAssets: extras.endingAssets ?? 0,
    retirementScore: 70,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

// 기준선도 이제 computeSensitivityAnalysis가 직접 계산한다 — 변형이 하나도 걸리지 않은 호출.
function isBaselineCall(p: SimulationParams): boolean {
  return p.assets[0]?.totalReturn === baseParams.assets[0]?.totalReturn
    && p.inflationRate === baseParams.inflationRate
    && p.userProfile.retirementAge === baseParams.userProfile.retirementAge;
}

function makeMockEngine(
  depletionAgeByLabel: Record<string, number | null>,
  baseline: SimulationResult = makeResult(88)
): SimulationEngine {
  const runSingle = vi.fn((params: SimulationParams) => {
    // 수익률 축은 이제 «이동된 총수익률»이 표식이다. 상대 이동이라 baseline(7)과 두 행(5·9)이
    // 서로 다른 값을 갖는다 — 절대 프리셋 시절에는 중립형이 baseline과 우연히 같아
    // totalReturn만으로 구분할 수 없었고, 그래서 yieldPreset 키를 표식으로 써야 했다.
    const base = baseParams.assets[0].totalReturn;
    if (params.assets[0].totalReturn === base - YIELD_SHIFT) return makeResult(depletionAgeByLabel['yieldDown']);
    if (params.assets[0].totalReturn === base + YIELD_SHIFT) return makeResult(depletionAgeByLabel['yieldUp']);
    if (params.inflationRate === 3) return makeResult(depletionAgeByLabel['inflationUp']);
    if (params.inflationRate === 1) return makeResult(depletionAgeByLabel['inflationDown']);
    if (params.userProfile.retirementAge === 57) return makeResult(depletionAgeByLabel['retirementEarlier']);
    if (params.userProfile.retirementAge === 63) return makeResult(depletionAgeByLabel['retirementLater']);
    if (isBaselineCall(params)) return baseline;
    throw new Error(`unexpected params: ${JSON.stringify(params)}`);
  });
  return { runSingle } as unknown as SimulationEngine;
}

function callsOf(engine: SimulationEngine): SimulationParams[][] {
  return (engine.runSingle as unknown as { mock: { calls: SimulationParams[][] } }).mock.calls;
}

describe('computeSensitivityAnalysis', () => {
  // **대입이 아니라 가산이다.** 절대 프리셋 시절에는 자산·ISA에 stockGrowth를, 사적연금에
  // pensionReturn을 «일괄 대입»했다. 그래서 계좌마다 다르던 사용자 가정이 통째로 사라지고
  // 모든 계좌가 같은 값이 됐다.
  //
  // 세 계좌의 기준값을 서로 다르게 둔 것이 요점이다(자산 7 · ISA 5 · 연금 4). 대입이면 셋이
  // 같은 값으로 뭉치고, 가산이면 간격이 그대로 보존된다 — 픽스처가 그 둘을 구별한다.
  test('수익률 시나리오는 모든 위험자산의 총수익률에 같은 폭을 «더한다»', () => {
    const engine = makeMockEngine({
      yieldDown: 85, yieldUp: 90, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    });
    computeSensitivityAnalysis(baseParams, engine);

    const calls = callsOf(engine);
    for (const delta of [-YIELD_SHIFT, YIELD_SHIFT]) {
      const call = calls.find((c) =>
        c[0].assets[0].totalReturn === baseParams.assets[0].totalReturn + delta)![0];

      expect(call.assets[0].totalReturn).toBe(baseParams.assets[0].totalReturn + delta);
      expect(call.isaAccounts![0].totalReturn).toBe(baseParams.isaAccounts![0].totalReturn + delta);
      expect(call.privatePensions[0].totalReturn).toBe(baseParams.privatePensions[0].totalReturn + delta);
      // 배당률은 그대로다. totalReturn이 배당을 포함하므로 이동분은 가격상승분이 흡수한다 —
      // 배당률까지 함께 옮기면 배당을 이중으로 움직이게 된다.
      expect(call.assets[0].dividendYield).toBe(baseParams.assets[0].dividendYield);
      expect(call.isaAccounts![0].dividendYield).toBe(baseParams.isaAccounts![0].dividendYield);
    }
  });

  // **폭의 근거를 잠근다.** 구현은 이 폭을 프리셋 표의 간격에서 «유도»한다 — 새 금융 가정을
  // 만들지 않기 위해서다. 유도가 성립하려면 두 간격이 같아야 하고, 표를 5/7/10처럼 고치면
  // 「한 단계」가 어느 쪽인지 모호해진다. 그때 조용히 한쪽이 뽑히지 않도록 여기서 멈춰 세운다.
  test('수익률 축의 폭은 프리셋 표의 간격에서 온다', () => {
    const { conservative, base, aggressive } = YIELD_PRESET_RATES;

    expect(base.stockGrowth - conservative.stockGrowth)
      .toBe(aggressive.stockGrowth - base.stockGrowth);
    expect(base.stockGrowth - conservative.stockGrowth).toBe(YIELD_SHIFT);

    // 라벨이 그 폭을 사용자에게 그대로 말한다.
    const engine = makeMockEngine({
      yieldDown: 85, yieldUp: 90, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    });
    const { scenarios } = computeSensitivityAnalysis(baseParams, engine);
    expect(scenarios.find((s) => s.key === 'yieldDown')!.label).toBe(`수익률 -${YIELD_SHIFT}%p`);
    expect(scenarios.find((s) => s.key === 'yieldUp')!.label).toBe(`수익률 +${YIELD_SHIFT}%p`);
  });

  test('물가상승률/은퇴시점 시나리오는 해당 필드만 바꾸고 나머지는 baseParams와 동일하다', () => {
    const engine = makeMockEngine({
      yieldDown: 88, yieldUp: 88, inflationUp: 85, inflationDown: 90,
      retirementEarlier: 86, retirementLater: 89,
    });
    computeSensitivityAnalysis(baseParams, engine);

    const calls = callsOf(engine);
    const inflationUpCall = calls.find((c) => c[0].inflationRate === 3)![0];
    expect(inflationUpCall.assets[0].totalReturn).toBe(7); // 변경 없음
    expect(inflationUpCall.userProfile.retirementAge).toBe(60); // 변경 없음

    const retirementEarlierCall = calls.find((c) => c[0].userProfile.retirementAge === 57)![0];
    expect(retirementEarlierCall.inflationRate).toBe(2); // 변경 없음
  });

  test('retirementEarlier는 currentAge + 1 미만으로 내려가지 않도록 clamp된다', () => {
    const params: SimulationParams = {
      ...baseParams,
      userProfile: { currentAge: 58, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
    };
    const runSingle = vi.fn((_p: SimulationParams) => makeResult(85));
    const engine = { runSingle } as unknown as SimulationEngine;

    computeSensitivityAnalysis(params, engine);

    const earlierCall = callsOf(engine).find((c) => c[0].userProfile.retirementAge < 60);
    expect(earlierCall![0].userProfile.retirementAge).toBe(59); // max(58+1, 60-3=57) = 59
  });

  test('retirementLater는 expectancy - 1을 넘지 않도록 clamp된다', () => {
    const params: SimulationParams = {
      ...baseParams,
      userProfile: { currentAge: 40, retirementAge: 88, expectancy: 90, targetMonthlySpending: 3000000 },
    };
    const runSingle = vi.fn((_p: SimulationParams) => makeResult(85));
    const engine = { runSingle } as unknown as SimulationEngine;

    computeSensitivityAnalysis(params, engine);

    const laterCall = callsOf(engine).find((c) => c[0].userProfile.retirementAge > 88);
    expect(laterCall![0].userProfile.retirementAge).toBe(89); // min(90-1=89, 88+3=91) = 89
  });

  test('depletionAge가 빠른(위험한) 시나리오부터 정렬되고, null(평생 유지)은 항상 뒤로 간다', () => {
    const engine = makeMockEngine({
      yieldDown: 82, yieldUp: null, inflationUp: 86, inflationDown: null,
      retirementEarlier: 84, retirementLater: 89,
    });
    const { scenarios } = computeSensitivityAnalysis(baseParams, engine);

    const nonNullKeys = scenarios.filter((s) => s.depletionAge !== null).map((s) => s.key);
    expect(nonNullKeys).toEqual(['yieldDown', 'retirementEarlier', 'inflationUp', 'retirementLater']);
    const nullKeys = scenarios.filter((s) => s.depletionAge === null).map((s) => s.key);
    expect(nullKeys.sort()).toEqual(['inflationDown', 'yieldUp'].sort());
    expect(scenarios.slice(-2).every((s) => s.depletionAge === null)).toBe(true);
  });

  test('deltaYears는 baseline/시나리오의 null 조합 4가지를 모두 올바르게 계산한다', () => {
    // baseline=88(둘 다 숫자), yieldConservative=82 -> delta = 82-88 = -6
    // baseline=88, yieldAggressive=null(시나리오만 null, 평생 유지로 개선) -> delta = expectancy(90)-88 = +2
    const engine = makeMockEngine({
      yieldDown: 82, yieldUp: null, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    });
    const { scenarios } = computeSensitivityAnalysis(baseParams, engine);
    expect(scenarios.find((s) => s.key === 'yieldDown')!.deltaYears).toBe(-6);
    expect(scenarios.find((s) => s.key === 'yieldUp')!.deltaYears).toBe(2);
  });

  test('baseline도 null(평생 유지)이고 시나리오도 null이면 deltaYears는 null이다', () => {
    const engine = makeMockEngine({
      yieldDown: null, yieldUp: null, inflationUp: null, inflationDown: null,
      retirementEarlier: null, retirementLater: null,
    }, makeResult(null));
    const { scenarios, baselineDepletionAge } = computeSensitivityAnalysis(baseParams, engine);
    expect(baselineDepletionAge).toBeNull();
    scenarios.forEach((s) => {
      expect(s.depletionAge).toBeNull();
      expect(s.deltaYears).toBeNull();
    });
  });

  test('baseline은 숫자인데 시나리오가 null(평생 유지로 개선)이면 deltaYears는 expectancy - baseline이다', () => {
    const engine = makeMockEngine({
      yieldDown: 88, yieldUp: null, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    }, makeResult(80));
    const { scenarios } = computeSensitivityAnalysis(baseParams, engine);
    expect(scenarios.find((s) => s.key === 'yieldUp')!.deltaYears).toBe(10); // 90 - 80
  });

  // B5: "고갈 없음"의 센티널은 고정값이 아니라 그 계획의 기대수명이어야 한다.
  // 90세로 고정하면 기대수명 100세인 계획에서 95세 고갈 시나리오가 고갈이 전혀 없는
  // baseline보다 5년 "낫다"고 보고된다.
  test('고갈 없음 센티널은 그 계획의 기대수명이다', () => {
    const params: SimulationParams = {
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 100 },
    };
    const runSingle = vi.fn((p: SimulationParams) => {
      if (p.assets[0]?.totalReturn === 5) return makeResult(95);
      return makeResult(null);
    });
    const engine = { runSingle } as unknown as SimulationEngine;

    const { scenarios } = computeSensitivityAnalysis(params, engine);

    expect(scenarios.find((s) => s.key === 'yieldDown')!.deltaYears).toBe(-5);
  });

  // **왜 연속형 지표가 필요한가.**
  //
  // depletionAge만 보고하면 여유 있는 계획에서는 7개 시나리오가 전부 null이 되어 화면이
  // "고갈 위험 없습니다" 한 줄로 접힌다. 실제 리포트에서 수익률 가정(안정형/공격형)이 기말자산을
  // 수억 원 갈라놓는데도 사용자는 "아무 차이 없음"을 봤다. 재계산은 이미 하고 있었고, 그 결과에서
  // 버려지던 값을 함께 싣는다.
  describe('연속형 지표', () => {
    test('기말자산과 baseline 대비 증감을 함께 보고한다', () => {
      const runSingle = vi.fn((params: SimulationParams) => {
        if (params.assets[0]?.totalReturn === 5) return makeResult(null, { endingAssets: 820000000 });
        if (isBaselineCall(params)) return makeResult(null, { endingAssets: 2500000000 });
        return makeResult(null, { endingAssets: 3000000000 });
      });
      const engine = { runSingle } as unknown as SimulationEngine;

      const { scenarios, baselineEndingAssets } = computeSensitivityAnalysis(baseParams, engine);

      expect(baselineEndingAssets).toBe(2500000000);

      // totalReturn === 5는 yieldConservative(stockGrowth 5%)에서 나온다.
      const yieldConservative = scenarios.find((s) => s.key === 'yieldDown')!;
      expect(yieldConservative.endingAssets).toBe(820000000);
      expect(yieldConservative.endingAssetsDelta).toBe(820000000 - 2500000000);

      // totalReturn === 9(yieldAggressive)는 위 두 분기 어디에도 걸리지 않아 else로 떨어진다.
      // yieldBase(totalReturn 7)는 baseline과 자산 수익률이 같아 isBaselineCall에 걸리므로
      // 별도로 확인하지 않는다 — 이 목(mock)의 한계이지 프로덕션 코드의 오분류가 아니다.
      const yieldAggressive = scenarios.find((s) => s.key === 'yieldUp')!;
      expect(yieldAggressive.endingAssetsDelta).toBe(3000000000 - 2500000000);
    });

    // 자산이 남아 있어도 목표 생활비를 못 채운 해는 계획이 실패한 해다. depletionAge는
    // 그 해를 잡지 못한다(인출 경로가 잔액을 넘겨 인출하지 않아 totalAssets가 0이 되지 않는다).
    test('목표 생활비를 채우지 못한 해의 수를 보고한다', () => {
      const yearlyResults = [
        makeYearlyResult({ age: 80, unmetSpending: 0 }),
        makeYearlyResult({ age: 81, unmetSpending: 1200000 }),
        makeYearlyResult({ age: 82, unmetSpending: 3600000 }),
      ];
      const runSingle = vi.fn(() => makeResult(null, { yearlyResults }));
      const engine = { runSingle } as unknown as SimulationEngine;

      const { scenarios } = computeSensitivityAnalysis(baseParams, engine);

      expect(scenarios[0].unmetSpendingYears).toBe(2);
    });
  });

  // **은퇴시점 시나리오가 무효였던 이유.**
  //
  // 엔진은 일반자산 매도 개시를 withdrawalPlan.generalAssetWithdrawalStartAge ?? retirementAge로
  // 읽는다. 그런데 센티널 단계(verifiedSentinelPlan의 SENTINEL_AXES)가 이 필드를 항상 채우므로,
  // retirementAge만 3년 옮긴 시나리오는 은퇴만 당겨지고 자산 인출은 옛 나이에 그대로 머물렀다.
  test('은퇴시점 시나리오는 일반자산 인출 개시 나이도 함께 옮긴다', () => {
    const params: SimulationParams = {
      ...baseParams,
      withdrawalPlan: { generalAssetWithdrawalStartAge: 60 },
    };
    const runSingle = vi.fn((_p: SimulationParams) => makeResult(85));
    const engine = { runSingle } as unknown as SimulationEngine;

    computeSensitivityAnalysis(params, engine);

    const calls = callsOf(engine);
    const earlier = calls.find((c) => c[0].userProfile.retirementAge === 57)![0];
    expect(earlier.withdrawalPlan?.generalAssetWithdrawalStartAge).toBe(57);

    const later = calls.find((c) => c[0].userProfile.retirementAge === 63)![0];
    expect(later.withdrawalPlan?.generalAssetWithdrawalStartAge).toBe(63);
  });

  test('일반자산 인출 개시 나이가 설정되지 않았으면 만들어 내지 않는다', () => {
    // 미설정은 "은퇴 나이를 따른다"는 뜻이라(엔진의 ?? 폴백) 이미 함께 움직인다.
    // 여기서 값을 채워 넣으면 사용자가 설정하지 않은 계획을 시나리오가 지어내는 셈이다.
    const runSingle = vi.fn((_p: SimulationParams) => makeResult(85));
    const engine = { runSingle } as unknown as SimulationEngine;

    computeSensitivityAnalysis(baseParams, engine);

    const earlier = callsOf(engine).find((c) => c[0].userProfile.retirementAge === 57)![0];
    expect(earlier.withdrawalPlan?.generalAssetWithdrawalStartAge).toBeUndefined();
  });

  // **이 블록이 이 변경의 존재 이유다.**
  //
  // 리포트가 보고한 모순: 기준 시나리오는 90세에 자산이 정확히 0원인데, 민감도 분석에서는
  // 투자수익률 -2%p·물가 +1%p가 전부 "평생 유지"로 나왔다. 원인은 「평생 소비 최적화」
  // 계획에서 시나리오마다 이진탐색이 다시 돌아 생활비를 낮춰 버린 것이었다.
  describe('생활비 고정', () => {
    const maxSustainableParams: SimulationParams = {
      ...baseParams,
      userProfile: { currentAge: 51, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3500000 },
      assets: [
        { id: 'a1', type: 'etf', ticker: 'QQQ', name: 'QQQ', quantity: 100, averagePrice: 1000000,
          totalReturn: 7, dividendYield: 1.5, monthlyContribution: 1000000,
          reinvestDividend: true, currency: 'KRW' },
      ],
      nationalPension: { expectedMonthlyAmount: 2000000 },
      inflationRate: 2.5,
      spendingStrategy: 'max_sustainable',
    };

    test('7개 시나리오와 기준선이 모두 같은 월 생활비를 쓴다', () => {
      const engine = new SimulationEngine();
      const spy = vi.spyOn(engine, 'runSingle');

      const { frozenMonthlySpending } = computeSensitivityAnalysis(maxSustainableParams, engine);

      // 이진탐색으로 확정된 금액이 사용자가 입력한 목표(350만원)와 다르다는 것이 전제다.
      expect(frozenMonthlySpending).toBeGreaterThan(0);
      expect(frozenMonthlySpending).not.toBe(3500000);

      // 이진탐색(engine.run 내부) 호출을 지나 시나리오 실행 구간만 본다: 기준선 1 + 시나리오 7.
      const scenarioCalls = spy.mock.calls.slice(-8);
      expect(scenarioCalls).toHaveLength(8);
      scenarioCalls.forEach(([p]) => {
        expect(p.userProfile.targetMonthlySpending).toBe(frozenMonthlySpending);
        // 전략 문자열을 바꾸면 사적연금 인출 규칙이 달라진다(SimulationEngine.ts:882).
        expect(p.spendingStrategy).toBe('max_sustainable');
      });
    });

    test('[통합] 평생 소비 최적화 계획에서 수익률 -2%p 행은 기준선보다 이르게 고갈된다', () => {
      const engine = new SimulationEngine();

      const { scenarios, baselineDepletionAge, baselineEndingAssets } =
        computeSensitivityAnalysis(maxSustainableParams, engine);

      // 전제: 최적화 계획은 기대수명 시점에 자산을 거의 다 쓴다.
      expect(baselineEndingAssets).toBeLessThan(maxSustainableParams.userProfile.targetMonthlySpending * 12);

      const conservative = scenarios.find((s) => s.key === 'yieldDown')!;
      const aggressive = scenarios.find((s) => s.key === 'yieldUp')!;
      const baselineEffective = baselineDepletionAge ?? maxSustainableParams.userProfile.expectancy;

      // 예전 구현은 여기서 conservative.depletionAge가 null이었다 — 생활비를 다시 낮춰 버렸기 때문이다.
      expect(conservative.depletionAge).not.toBeNull();
      expect(conservative.depletionAge!).toBeLessThan(baselineEffective);
      expect(conservative.endingAssetsDelta).toBeLessThanOrEqual(0);

      // 반대 방향도 살아 있어야 한다 — 수익률 가정이 좋아지면 자산이 남는다.
      expect(aggressive.endingAssetsDelta).toBeGreaterThan(0);
    });

    test('고정 전략이 아닌 계획은 사용자가 입력한 목표 생활비를 그대로 보고한다', () => {
      const engine = makeMockEngine({
        yieldDown: 85, yieldUp: 90, inflationUp: 88, inflationDown: 88,
        retirementEarlier: 88, retirementLater: 88,
      });

      const { frozenMonthlySpending } = computeSensitivityAnalysis(baseParams, engine);

      expect(frozenMonthlySpending).toBe(3000000);
    });
  });

  test('특정 시나리오가 예외를 던져도 나머지 5개는 정상 반환된다', () => {
    const runSingle = vi.fn((params: SimulationParams) => {
      if (params.assets[0]?.totalReturn === 5) throw new Error('시뮬레이션 실패');
      return makeResult(85);
    });
    const engine = { runSingle } as unknown as SimulationEngine;

    const { scenarios } = computeSensitivityAnalysis(baseParams, engine);

    expect(scenarios).toHaveLength(5);
    expect(scenarios.find((s) => s.key === 'yieldDown')).toBeUndefined();
  });

  // **예전에는 이 자리가 「수익률 축은 절대 앵커로 잰다」였다.**
  //
  // 그 블록의 근거는 「±2%p는 가중평균이 7.6%인 계획에서 프리셋과 사실상 같은 자리를 잰다」
  // 였다. 그것은 가정이 7% 근처인 사용자에게만 참이고, 바로 그 사용자에게는 두 축이 같으니
  // 절대 앵커를 «고를» 이유도 되지 못한다. 갈리는 것은 가정이 멀리 있는 사용자이고, 거기서
  // 절대 앵커는 두 가지로 틀렸다 — 같은 이름의 행이 사람마다 다른 크기의 충격을 재고,
  // 가정이 9%보다 높으면 세 행이 전부 기준선 아래로 내려간다(known-issues 16번).
  describe('수익률 축은 내 가정 대비 상대 이동으로 잰다', () => {
    test('두 행이 나오고 절대 프리셋 행은 없다', () => {
      const analysis = computeSensitivityAnalysis(baseParams, new SimulationEngine());

      const keys = analysis.scenarios.map((s) => s.key);
      expect(keys).toContain('yieldDown');
      expect(keys).toContain('yieldUp');
      // 절대 앵커 시절의 세 키는 이제 존재하지 않는다.
      expect(keys).not.toContain('yieldConservative');
      expect(keys).not.toContain('yieldBase');
      expect(keys).not.toContain('yieldAggressive');
    });

    // **오라클을 구현에서 가져오지 않는다.** shiftYield를 import해 쓰면 그 함수가 틀려도
    // 테스트가 함께 틀린다. 이동된 계획을 여기서 손으로 만들어 같은 경로로 돌린 결과와
    // 맞춰 본다.
    test('각 행은 모든 위험자산을 그만큼 옮긴 계획의 결과다', () => {
      const params = baseParams;
      const engine = new SimulationEngine();
      const analysis = computeSensitivityAnalysis(params, engine);
      const frozen = freezeSpendingPlan(params, engine);

      for (const [key, delta] of [['yieldDown', -YIELD_SHIFT], ['yieldUp', YIELD_SHIFT]] as const) {
        const expected = runFrozenPlan(engine, mapFrozenPlan(frozen, (p) => ({
          ...p,
          assets: p.assets.map((a) => ({ ...a, totalReturn: a.totalReturn + delta })),
          privatePensions: p.privatePensions.map((x) => ({ ...x, totalReturn: x.totalReturn + delta })),
          isaAccounts: p.isaAccounts?.map((i) => ({ ...i, totalReturn: i.totalReturn + delta })),
        })));

        expect(analysis.scenarios.find((s) => s.key === key)!.endingAssets)
          .toBeCloseTo(expected.endingAssets, 6);
      }
    });

    // 절대 앵커가 실제로 틀렸던 자리. 가정이 프리셋 상단(9%)보다 높은 계획에서 예전에는
    // 세 행이 «전부» 기준선 아래로 내려갔고, 사용자는 그것을 「공격형으로 바꿨는데 왜 돈이
    // 줄지」로 읽었다. 상대 축에서는 위 행이 반드시 기준선보다 낫다.
    test('가정이 프리셋 상단보다 높아도 위 행은 기준선보다 낫다', () => {
      const rich: SimulationParams = {
        ...baseParams,
        assets: baseParams.assets.map((a) => ({ ...a, totalReturn: 12 })),
        privatePensions: baseParams.privatePensions.map((p) => ({ ...p, totalReturn: 12 })),
        isaAccounts: baseParams.isaAccounts?.map((i) => ({ ...i, totalReturn: 12 })),
      };
      const analysis = computeSensitivityAnalysis(rich, new SimulationEngine());

      expect(analysis.scenarios.find((s) => s.key === 'yieldUp')!.endingAssetsDelta)
        .toBeGreaterThan(0);
      expect(analysis.scenarios.find((s) => s.key === 'yieldDown')!.endingAssetsDelta)
        .toBeLessThan(0);
    });
  });

  // **이 블록이 「은퇴 ±3년 같은 민감도 결과에서 HARD 목표를 위반하는 시나리오는 재무적으로
  // 유리해도 별도의 경고 상태로 표시한다」는 요구의 근거다.**
  //
  // 화면과 PDF는 endingAssetsDelta로 정렬·채색한다. 그래서 시나리오가 재무적으로 유리하면
  // (기말자산이 baseline보다 크면) 초록 막대로 「개선」처럼 읽힌다 — 그 시나리오가 사용자가
  // 「반드시 지키기」로 못박은 HARD 조건(자산 고갈 방지·목표 생활비·기말자산 하한)을 어겨도
  // 마찬가지다. hardViolations는 그 경우를 판정에서 «가려내는» 필드다.
  describe('HARD 목표 위반 감지', () => {
    // 판정식은 goalSuccessConditions.resolveHardViolations 하나뿐이어야 한다
    // (MonteCarloEngine이 hardGoalSuccessProbability를 내는 데 쓰는 것과 같은 함수). 여기서
    // 새 술어를 다시 적으면 몬테카를로와 민감도 분석이 「이 계획이 HARD를 어겼는가」에 대해
    // 서로 다른 답을 하게 된다.
    test('목표를 하나도 고르지 않은(legacy) 계획은 모든 시나리오·기준선의 hardViolations가 빈 배열이다', () => {
      const engine = makeMockEngine({
        yieldDown: 40, yieldUp: 88, inflationUp: 88, inflationDown: 88,
        retirementEarlier: 88, retirementLater: 88,
      }, makeResult(40));
      // legacy 계획은 requireAssetSurvival=true지만 hardRequirements.assetSurvival은 항상
      // false다(legacy_plan 갈래는 확정 HARD 목표가 없다) — 그래서 40세라는 이른 고갈도
      // 위반으로 잡히면 안 된다. 이 값 자체가 회귀 대상이다.
      const { scenarios, baselineHardViolations } = computeSensitivityAnalysis(baseParams, engine);

      scenarios.forEach((s) => expect(s.hardViolations).toEqual([]));
      expect(baselineHardViolations).toEqual([]);
    });

    // **핵심 픽스처.** yieldAggressive는 baseline보다 기말자산이 25억원 더 많다(재무적으로
    // 명백히 유리) — 그런데도 고갈 나이(85세)가 확정 HARD 「자산 고갈 방지」가 요구하는
    // 기대수명(90세) 이전이라 그 조건을 어긴다. endingAssetsDelta만 보는 화면은 이 행을
    // 초록 막대로 그려 「개선」이라 말했을 것이다.
    test('기말자산이 baseline보다 늘어난(재무적으로 유리한) 시나리오도 확정 HARD 자산 고갈 방지를 어기면 hardViolations에 담긴다', () => {
      const params: SimulationParams = {
        ...baseParams,
        retirementGoals: [{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' }],
      };
      const baselineEndingAssets = 1500000000;
      const runSingle = vi.fn((p: SimulationParams) => {
        if (p.assets[0].totalReturn === baseParams.assets[0].totalReturn + YIELD_SHIFT) return makeResult(85, { endingAssets: 4000000000 });
        if (p.assets[0].totalReturn === baseParams.assets[0].totalReturn - YIELD_SHIFT) return makeResult(null, { endingAssets: 1000000000 });
        if (p.inflationRate === 3) return makeResult(null, { endingAssets: baselineEndingAssets });
        if (p.inflationRate === 1) return makeResult(null, { endingAssets: baselineEndingAssets });
        if (p.userProfile.retirementAge === 57) return makeResult(null, { endingAssets: baselineEndingAssets });
        if (p.userProfile.retirementAge === 63) return makeResult(null, { endingAssets: baselineEndingAssets });
        return makeResult(null, { endingAssets: baselineEndingAssets }); // baseline
      });
      const engine = { runSingle } as unknown as SimulationEngine;

      const { scenarios } = computeSensitivityAnalysis(params, engine);
      const aggressive = scenarios.find((s) => s.key === 'yieldUp')!;

      expect(aggressive.endingAssetsDelta).toBeGreaterThan(0); // 재무적으로 유리하다는 전제
      expect(aggressive.depletionAge).toBe(85); // 90세(expectancy) 이전에 고갈된다는 전제
      expect(aggressive.hardViolations).toEqual(['assetSurvival']);

      // 대조군: 위반하지 않는 나머지 시나리오는 빈 배열이다 — 모든 시나리오가 무조건
      // 'assetSurvival'을 받는 버그였다면 이 assertion이 잡는다.
      const conservative = scenarios.find((s) => s.key === 'yieldDown')!;
      expect(conservative.hardViolations).toEqual([]);
    });

    // 위와 같은 depletionAge=85(<expectancy 90)이지만 이번에는 자산 고갈 방지를 SOFT로만
    // 골랐다 — hardRequirements.assetSurvival이 꺼져 있으므로 위반으로 잡히면 안 된다.
    // hardViolations가 「고갈했는가」라는 원 술어가 아니라 «확정 HARD 게이트»로 걸러진
    // 결과라는 것을 이 테스트가 확인한다.
    test('같은 조기 고갈이라도 SOFT로 고른 목표는 hardViolations에 담기지 않는다', () => {
      const params: SimulationParams = {
        ...baseParams,
        retirementGoals: [{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'SOFT' }],
      };
      const runSingle = vi.fn((p: SimulationParams) => {
        if (p.assets[0].totalReturn === baseParams.assets[0].totalReturn + YIELD_SHIFT) return makeResult(85, { endingAssets: 4000000000 });
        return makeResult(null, { endingAssets: 1500000000 });
      });
      const engine = { runSingle } as unknown as SimulationEngine;

      const { scenarios } = computeSensitivityAnalysis(params, engine);
      expect(scenarios.find((s) => s.key === 'yieldUp')!.hardViolations).toEqual([]);
    });

    // 목표 생활비 축: 기말자산은 baseline보다 늘었지만(재무적으로 유리) 생활비 부족 해가
    // 발생해 확정 HARD 「생활비 안정」을 어긴다.
    test('생활비 부족 해가 있으면 기말자산이 늘어도 확정 HARD 생활비 조건을 위반으로 담는다', () => {
      const params: SimulationParams = {
        ...baseParams,
        retirementGoals: [{
          type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'HARD',
          targetValue: 3000000, targetValueSource: 'user',
        }],
      };
      const shortfallYears = [makeYearlyResult({ age: 80, unmetSpending: 500000 })];
      const runSingle = vi.fn((p: SimulationParams) => {
        if (p.assets[0].totalReturn === baseParams.assets[0].totalReturn + YIELD_SHIFT) {
          return makeResult(null, { endingAssets: 4000000000, yearlyResults: shortfallYears });
        }
        return makeResult(null, { endingAssets: 1500000000 });
      });
      const engine = { runSingle } as unknown as SimulationEngine;

      const { scenarios } = computeSensitivityAnalysis(params, engine);
      const aggressive = scenarios.find((s) => s.key === 'yieldUp')!;

      expect(aggressive.endingAssetsDelta).toBeGreaterThan(0);
      expect(aggressive.unmetSpendingYears).toBeGreaterThan(0);
      expect(aggressive.hardViolations).toEqual(['spendingTarget']);
    });

    // 기말자산 하한 축: 상속 목표액을 확정 HARD로 골랐는데 시나리오의 기말자산이 그 금액에
    // 못 미친다. baseline보다는 늘었지만(재무적으로 유리) 그 사실이 하한 미달을 가리면 안 된다.
    test('확정 HARD 기말자산 하한에 못 미치면 baseline보다 늘어도 위반으로 담는다', () => {
      const targetBequest = 2000000000;
      const params: SimulationParams = {
        ...baseParams,
        retirementGoals: [{
          type: 'INHERITANCE', priority: 1, constraintType: 'HARD',
          targetValue: targetBequest, targetValueSource: 'user',
        }],
      };
      const baselineEndingAssets = 500000000;
      const runSingle = vi.fn((p: SimulationParams) => {
        if (p.assets[0].totalReturn === baseParams.assets[0].totalReturn + YIELD_SHIFT) return makeResult(null, { endingAssets: 1200000000 });
        return makeResult(null, { endingAssets: baselineEndingAssets });
      });
      const engine = { runSingle } as unknown as SimulationEngine;

      const { scenarios } = computeSensitivityAnalysis(params, engine);
      const aggressive = scenarios.find((s) => s.key === 'yieldUp')!;

      expect(aggressive.endingAssetsDelta).toBeGreaterThan(0); // baseline(5억)보다 늘었다
      expect(aggressive.endingAssets).toBeLessThan(targetBequest); // 그래도 하한(20억) 미달
      expect(aggressive.hardViolations).toEqual(['terminalAsset']);
    });

    // baseline 자신이 이미 위반 중이면, 같은 위반을 반복하는 시나리오는 「새로운 나쁜 소식」이
    // 아니다 — 그 구별을 위해 baselineHardViolations를 시나리오와 나란히 보고한다.
    test('baseline 자신의 위반도 baselineHardViolations로 함께 보고한다', () => {
      const params: SimulationParams = {
        ...baseParams,
        retirementGoals: [{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' }],
      };
      const runSingle = vi.fn((_p: SimulationParams) => makeResult(70, { endingAssets: 100000000 }));
      const engine = { runSingle } as unknown as SimulationEngine;

      const { baselineHardViolations } = computeSensitivityAnalysis(params, engine);
      expect(baselineHardViolations).toEqual(['assetSurvival']);
    });
  });
});

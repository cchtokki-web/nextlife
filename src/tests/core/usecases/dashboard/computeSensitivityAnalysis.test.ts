import { describe, test, expect, vi } from 'vitest';
import { computeSensitivityAnalysis } from '@/core/usecases/dashboard/computeSensitivityAnalysis';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';

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
    if (params.assets[0]?.totalReturn === 5) return makeResult(depletionAgeByLabel['returnDown']);
    if (params.assets[0]?.totalReturn === 9) return makeResult(depletionAgeByLabel['returnUp']);
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
  test('투자수익률 시나리오는 assets/privatePensions/isaAccounts 수익률에 동일하게 델타를 적용한다', () => {
    const engine = makeMockEngine({
      returnDown: 85, returnUp: 90, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    });
    computeSensitivityAnalysis(baseParams, engine);

    const calls = callsOf(engine);
    const returnDownCall = calls.find((c) => c[0].assets[0].totalReturn === 5)![0];
    expect(returnDownCall.privatePensions[0].totalReturn).toBe(2); // 4 - 2
    expect(returnDownCall.isaAccounts![0].totalReturn).toBe(3); // 5 - 2

    const returnUpCall = calls.find((c) => c[0].assets[0].totalReturn === 9)![0];
    expect(returnUpCall.privatePensions[0].totalReturn).toBe(6); // 4 + 2
    expect(returnUpCall.isaAccounts![0].totalReturn).toBe(7); // 5 + 2
  });

  test('물가상승률/은퇴시점 시나리오는 해당 필드만 바꾸고 나머지는 baseParams와 동일하다', () => {
    const engine = makeMockEngine({
      returnDown: 88, returnUp: 88, inflationUp: 85, inflationDown: 90,
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
      returnDown: 82, returnUp: null, inflationUp: 86, inflationDown: null,
      retirementEarlier: 84, retirementLater: 89,
    });
    const { scenarios } = computeSensitivityAnalysis(baseParams, engine);

    const nonNullKeys = scenarios.filter((s) => s.depletionAge !== null).map((s) => s.key);
    expect(nonNullKeys).toEqual(['returnDown', 'retirementEarlier', 'inflationUp', 'retirementLater']);
    const nullKeys = scenarios.filter((s) => s.depletionAge === null).map((s) => s.key);
    expect(nullKeys.sort()).toEqual(['inflationDown', 'returnUp'].sort());
    expect(scenarios.slice(-2).every((s) => s.depletionAge === null)).toBe(true);
  });

  test('deltaYears는 baseline/시나리오의 null 조합 4가지를 모두 올바르게 계산한다', () => {
    // baseline=88(둘 다 숫자), returnDown=82 -> delta = 82-88 = -6
    // baseline=88, returnUp=null(시나리오만 null, 평생 유지로 개선) -> delta = expectancy(90)-88 = +2
    const engine = makeMockEngine({
      returnDown: 82, returnUp: null, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    });
    const { scenarios } = computeSensitivityAnalysis(baseParams, engine);
    expect(scenarios.find((s) => s.key === 'returnDown')!.deltaYears).toBe(-6);
    expect(scenarios.find((s) => s.key === 'returnUp')!.deltaYears).toBe(2);
  });

  test('baseline도 null(평생 유지)이고 시나리오도 null이면 deltaYears는 null이다', () => {
    const engine = makeMockEngine({
      returnDown: null, returnUp: null, inflationUp: null, inflationDown: null,
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
      returnDown: 88, returnUp: null, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    }, makeResult(80));
    const { scenarios } = computeSensitivityAnalysis(baseParams, engine);
    expect(scenarios.find((s) => s.key === 'returnUp')!.deltaYears).toBe(10); // 90 - 80
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

    expect(scenarios.find((s) => s.key === 'returnDown')!.deltaYears).toBe(-5);
  });

  // **왜 연속형 지표가 필요한가.**
  //
  // depletionAge만 보고하면 여유 있는 계획에서는 6개 시나리오가 전부 null이 되어 화면이
  // "고갈 위험 없습니다" 한 줄로 접힌다. 실제 리포트에서 수익률 ±2%p가 기말자산을 수억 원
  // 갈라놓는데도 사용자는 "아무 차이 없음"을 봤다. 재계산은 이미 하고 있었고, 그 결과에서
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

      const returnDown = scenarios.find((s) => s.key === 'returnDown')!;
      expect(returnDown.endingAssets).toBe(820000000);
      expect(returnDown.endingAssetsDelta).toBe(820000000 - 2500000000);

      const returnUp = scenarios.find((s) => s.key === 'returnUp')!;
      expect(returnUp.endingAssetsDelta).toBe(3000000000 - 2500000000);
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

    test('6개 시나리오와 기준선이 모두 같은 월 생활비를 쓴다', () => {
      const engine = new SimulationEngine();
      const spy = vi.spyOn(engine, 'runSingle');

      const { frozenMonthlySpending } = computeSensitivityAnalysis(maxSustainableParams, engine);

      // 이진탐색으로 확정된 금액이 사용자가 입력한 목표(350만원)와 다르다는 것이 전제다.
      expect(frozenMonthlySpending).toBeGreaterThan(0);
      expect(frozenMonthlySpending).not.toBe(3500000);

      // 이진탐색(engine.run 내부) 호출을 지나 시나리오 실행 구간만 본다: 기준선 1 + 시나리오 6.
      const scenarioCalls = spy.mock.calls.slice(-7);
      expect(scenarioCalls).toHaveLength(7);
      scenarioCalls.forEach(([p]) => {
        expect(p.userProfile.targetMonthlySpending).toBe(frozenMonthlySpending);
        // 전략 문자열을 바꾸면 사적연금 인출 규칙이 달라진다(SimulationEngine.ts:882).
        expect(p.spendingStrategy).toBe('max_sustainable');
      });
    });

    test('[통합] 평생 소비 최적화 계획에서 수익률 -2%p는 기준선보다 이르게 고갈된다', () => {
      const engine = new SimulationEngine();

      const { scenarios, baselineDepletionAge, baselineEndingAssets } =
        computeSensitivityAnalysis(maxSustainableParams, engine);

      // 전제: 최적화 계획은 기대수명 시점에 자산을 거의 다 쓴다.
      expect(baselineEndingAssets).toBeLessThan(maxSustainableParams.userProfile.targetMonthlySpending * 12);

      const down = scenarios.find((s) => s.key === 'returnDown')!;
      const up = scenarios.find((s) => s.key === 'returnUp')!;
      const baselineEffective = baselineDepletionAge ?? maxSustainableParams.userProfile.expectancy;

      // 예전 구현은 여기서 down.depletionAge가 null이었다 — 생활비를 다시 낮춰 버렸기 때문이다.
      expect(down.depletionAge).not.toBeNull();
      expect(down.depletionAge!).toBeLessThan(baselineEffective);
      expect(down.endingAssetsDelta).toBeLessThanOrEqual(0);

      // 반대 방향도 살아 있어야 한다 — 수익률이 좋아지면 자산이 남는다.
      expect(up.endingAssetsDelta).toBeGreaterThan(0);
    });

    test('고정 전략이 아닌 계획은 사용자가 입력한 목표 생활비를 그대로 보고한다', () => {
      const engine = makeMockEngine({
        returnDown: 85, returnUp: 90, inflationUp: 88, inflationDown: 88,
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
    expect(scenarios.find((s) => s.key === 'returnDown')).toBeUndefined();
  });
});

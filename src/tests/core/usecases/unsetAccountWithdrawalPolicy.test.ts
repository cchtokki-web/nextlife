import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { LegacySimulationEngine } from '@/core/usecases/SimulationEngine';
import { StrategyGenerator } from '@/core/strategy/StrategyGenerator';
import type { SimulationParams } from '@/core/entities/types';

/**
 * **「인출 정책 미지정」의 뜻은 하나이고, 그 뜻은 GENERAL_FIRST가 아니다.**
 *
 * 등록된 의심(known-issues 10번)은 「두 엔진이 미지정에 서로 다른 답을 갖고 있다」였다.
 * 실측하면 그렇지 않다 — `run(params)`와 `simulate(profile, strategy)`는 같은 `runSingle`에
 * 도달하고, 미지정에 대해 «같은» 답을 낸다. 진짜 사실은 그보다 단순하고 더 중요하다:
 *
 *   미지정 계획은 사적연금을 부족분과 무관하게 정기 지급하고(잔여 개월 균등분할 또는
 *   privatePensionMonthlyTarget), 정책을 명시하면 그 지급이 사라진다.
 *
 * 엔진에서 미지정을 읽는 곳은 두 군데뿐이다 — 사적연금 정기 지급 게이트(사적연금 루프 «안»)와
 * WithdrawalEngine 호출의 `?? 'GENERAL_FIRST'`. 그래서 사적연금이 있으면 두 값이 다른 계획이고,
 * 없으면 «증명 가능하게» 같은 계획이다. 이 두 사실 위에 후보 생성기의 축 크기 규칙이 서 있다.
 *
 * 이 테스트가 깨진다면 그것은 표시 문제가 아니라 저장된 시나리오의 «결과»가 바뀌었다는 뜻이다.
 */

const engine = new LegacySimulationEngine();

const base: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3_000_000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'KODEX200', name: 'KODEX 200',
      quantity: 1, averagePrice: 300_000_000,
      totalReturn: 5, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW',
    },
  ],
  isaAccounts: [],
  nationalPension: { expectedMonthlyAmount: 1_000_000 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 200_000_000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1400,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
  yieldPreset: 'base',
};

const withoutPrivatePension: SimulationParams = { ...base, privatePensions: [] };

/** 정책만 GENERAL_FIRST로 써넣은 같은 계획. */
function withGeneralFirst(params: SimulationParams): SimulationParams {
  return {
    ...params,
    withdrawalPlan: { ...(params.withdrawalPlan ?? {}), accountWithdrawalPolicy: 'GENERAL_FIRST' },
  };
}

/** params 경로. */
function ledgerViaRun(params: SimulationParams): string {
  return JSON.stringify(engine.run(params).yearlyResults);
}

/** 카드의 숫자를 만드는 경로(StrategyOptimizer가 후보마다 부르는 것). */
function ledgerViaSimulate(params: SimulationParams): string {
  const input = LegacySimulationAdapter.fromLegacy(params);
  return JSON.stringify(engine.simulate(input.profile, input.strategy).yearlyResults);
}

describe('인출 정책 미지정', () => {
  test('사적연금이 있으면 GENERAL_FIRST와 다른 계획이다', () => {
    expect(ledgerViaRun(base)).not.toBe(ledgerViaRun(withGeneralFirst(base)));
  });

  test('사적연금이 없으면 GENERAL_FIRST와 같은 계획이다', () => {
    // 후보 생성기의 축 크기 규칙(미지정 슬롯이 GENERAL_FIRST를 대신하는 조건)이 이 사실에
    // 기대고 있다. 엔진이 미지정을 읽는 자리가 사적연금 루프 밖으로 나가면 여기서 걸린다.
    expect(ledgerViaRun(withoutPrivatePension))
      .toBe(ledgerViaRun(withGeneralFirst(withoutPrivatePension)));
  });

  test('두 진입점이 미지정에 같은 답을 낸다', () => {
    // 등록된 가설은 「run은 움직이고 simulate는 움직이지 않는다」였다. 두 경로 모두
    // runSingle에 도달하므로 그럴 수 없고, 실제로 두 경로의 원장이 비트 단위로 같다.
    expect(ledgerViaSimulate(base)).toBe(ledgerViaRun(base));
    expect(ledgerViaSimulate(withGeneralFirst(base))).toBe(ledgerViaRun(withGeneralFirst(base)));
    // 「GENERAL_FIRST를 써넣으면 움직이는가」라는 질문에도 두 경로의 답이 같아야 한다.
    expect(ledgerViaSimulate(base) !== ledgerViaSimulate(withGeneralFirst(base)))
      .toBe(ledgerViaRun(base) !== ledgerViaRun(withGeneralFirst(base)));
  });
});

describe('후보 격자는 미지정을 기본값으로 메우지 않는다', () => {
  const policiesFor = (params: SimulationParams) => {
    const input = LegacySimulationAdapter.fromLegacy(params);
    const result = new StrategyGenerator().generate(input.profile, input.goals, input.strategy);
    return new Set(result.candidates.map((item) => item.dimensions.withdrawalPolicy));
  };

  test('사적연금이 없으면 GENERAL_FIRST 슬롯이 사용자의 현재 값(미지정)이 된다', () => {
    const policies = policiesFor(withoutPrivatePension);
    expect(policies).toContain(undefined);
    expect(policies).not.toContain('GENERAL_FIRST');
  });

  test('사적연금이 있으면 GENERAL_FIRST는 진짜 대안이므로 그대로 둔다', () => {
    const policies = policiesFor(base);
    expect(policies).toContain('GENERAL_FIRST');
  });

  test('격자 후보의 dimensions와 strategy가 같은 것을 말한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(withoutPrivatePension);
    const result = new StrategyGenerator().generate(input.profile, input.goals, input.strategy);
    for (const candidate of result.candidates) {
      expect(candidate.strategy.withdrawalPolicy.accountWithdrawalPolicy)
        .toBe(candidate.dimensions.withdrawalPolicy);
    }
    // 미지정 «격자» 후보는 키 자체가 없어야 한다. undefined 값을 가진 키를 남기면
    // sameStrategy의 키 개수 비교가 seed와 어긋나, 사용자의 현재 계획과 같은 격자 칸이
    // 현상 유지 후보와 겹치는 것으로 인식되지 않는다.
    //
    // 현상 유지 후보(id 'baseline')는 seed를 그대로 복제하므로 이 판정을 언제나 통과한다.
    // 격자 후보만 골라야 판정이 의미를 갖는다.
    const asIs = result.candidates.find((item) =>
      item.id !== 'baseline' && item.dimensions.withdrawalPolicy === undefined)!;
    expect(asIs).toBeDefined();
    expect('accountWithdrawalPolicy' in asIs.strategy.withdrawalPolicy).toBe(false);
  });
});

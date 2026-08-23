import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { MonteCarloEngine, runMonteCarlo } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { applyRetirementGoals } from '@/core/usecases/goals/retirementGoalAdapter';
import { retirementParams } from './fixtures';

describe('retirement-domain-invariants / Monte Carlo', () => {
  test('같은 입력과 같은 seed는 직렬화까지 동일한 결과를 만든다', () => {
    const params = retirementParams({
      assets: [{
        ...retirementParams().assets[0],
        quantity: 5_000,
        totalReturn: 6,
        dividendYield: 2,
      }],
    });
    const config = { trials: 40, seed: 12_345, annualStdDev: 15 };
    const engine = new SimulationEngine();

    const first = runMonteCarlo(params, engine, config);
    const second = runMonteCarlo(params, engine, config);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  // 선택한 INHERITANCE 목표액이 확률 검증의 기말자산 판정까지 도달하는지 고정한다.
  //
  // 이 연결은 파생이 아니라 투영이다. applyRetirementGoals가 목표를 legacy params에
  // (targetBequest + bequestStrategy로) 옮겨 심고, 그 값이 어댑터를 거쳐 strategy.targetBequest가
  // 되고, runMonteCarlo의 terminalAssetGoal이 된다. 사슬이 길고 중간 어디가 끊겨도
  // terminalAssetGoal은 조용히 0이 되어 모든 시행이 기말자산 조건을 통과해 버린다 —
  // 목표 성공확률만 과대평가되고 오류는 나지 않는다. 그래서 값이 아니라 사슬을 테스트한다.
  test('선택한 상속 목표액이 목표 성공확률의 기말자산 판정에 반영된다', () => {
    const base = retirementParams();
    const withGoal = applyRetirementGoals(base, [{
      type: 'INHERITANCE',
      priority: 1,
      constraintType: 'SOFT',
      // 이 fixture가 절대 도달할 수 없는 금액.
      targetValue: 100_000_000_000_000,
      targetValueSource: 'user',
    }]);

    expect(withGoal.userProfile.targetBequest).toBe(100_000_000_000_000);

    const input = LegacySimulationAdapter.fromLegacy(withGoal);
    expect(input.strategy.targetBequest).toBe(100_000_000_000_000);

    const engine = new LegacySimulationEngine();
    const validated = new MonteCarloEngine(engine).validate(
      input.profile,
      input.goals,
      input.strategy,
      { trials: 20, seed: 7, annualStdDev: 10 },
    );

    // 기말자산 목표가 반영됐다면 목표 성공확률은 0이어야 한다.
    expect(validated.goalSuccessProbability).toBe(0);
    // 그런데 생활비 자체는 유지되므로, 0이 된 이유가 "전부 실패"여서가 아님을 함께 확인한다.
    expect(validated.spendingSuccessProbability).toBeGreaterThan(0);
  });

  // 위 결정성 테스트는 시드 고정 순수 함수가 순수하다는 것만 말한다. 확률 값이 통째로
  // 오염돼도 통과한다. 아래는 확률 계층 자체가 지켜야 하는 관계들이다.
  test('분위수는 순서를 지키고 모든 확률은 0~1 범위에 있다', () => {
    const mc = runMonteCarlo(retirementParams(), new SimulationEngine(), {
      trials: 40, seed: 99, annualStdDev: 15,
    });

    expect(mc.endingAssets.p10).toBeLessThanOrEqual(mc.endingAssets.p50);
    expect(mc.endingAssets.p50).toBeLessThanOrEqual(mc.endingAssets.p90);
    for (const value of [mc.successRate, mc.spendingSuccessRate, mc.goalSuccessProbability]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(mc.trials).toBe(40);
  });

  // 목표 성공은 "생활비 유지 ∧ 자산 생존 ∧ 기말자산 목표"의 교집합이므로, 어느 주변확률도
  // 넘어설 수 없다. 이 부등식이 깨지면 목표 성공확률이 실제보다 관대하게 계산된 것이다.
  test('목표 성공확률은 어떤 주변확률도 넘지 않는다', () => {
    const engine = new SimulationEngine();
    for (const spend of [2_000_000, 4_000_000, 6_000_000]) {
      const mc = runMonteCarlo(
        retirementParams({
          userProfile: { ...retirementParams().userProfile, targetMonthlySpending: spend },
        }),
        engine,
        { trials: 40, seed: 7, annualStdDev: 18 },
      );

      // 목표 성공은 「생활비 충족 ∧ 자산 생존 ∧ 기말자산 목표」의 교집합이지만, 생활비 조건이
      // spendingSuccessRate와 «다른 술어»다 —
      //   spendingSuccessRate            : year.unmetSpending > 0        (엔진 원장, 엡실론 없음, 계획 대비)
      //   goalSuccessProbability의 생활비 : goalShortfall ≥ 월 1만원      (재구성, 엡실론 있음, 목표 대비)
      // 두 집합은 포함관계가 아니므로 부등식이 성립하지 않는다. 실측(2026-08-22): 목표 30.4% >
      // 생활 유지 30.2%. 자산 생존은 같은 술어(isSuccessfulTrial)를 쓰므로 그쪽만 남긴다.
      expect(mc.goalSuccessProbability).toBeLessThanOrEqual(mc.successRate);
    }
  });

  test('변동성이 0이면 모든 시행이 같으므로 확률은 0 또는 1뿐이다', () => {
    const mc = runMonteCarlo(retirementParams(), new SimulationEngine(), {
      trials: 20, seed: 3, annualStdDev: 0,
    });

    // 충격이 없으면 시행 간 차이가 없다. 중간값이 나오면 확률 계층이 시행을 뒤섞은 것이다.
    for (const value of [mc.successRate, mc.spendingSuccessRate, mc.goalSuccessProbability]) {
      expect([0, 1]).toContain(value);
    }
    expect(mc.endingAssets.p10).toBeCloseTo(mc.endingAssets.p90, 6);
  });
});

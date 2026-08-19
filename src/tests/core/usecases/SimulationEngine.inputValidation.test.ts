import { describe, expect, test } from 'vitest';
import { InvalidSimulationInputError } from '@/core/entities/errors';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { runMonteCarlo } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { retirementParams } from '@/tests/core/retirement-domain-invariants/fixtures';

// 음수 목표 생활비는 **조용히 계획을 좋아 보이게 만든다.**
//
// 실측(동일 fixture): 정상 목표 생활비면 기말자산 82.7억인데, 목표 생활비를 -3,000,000으로
// 두면 지출이 수입처럼 작동해 기말자산이 103억으로 **늘어난다.** 오류도 경고도 없다.
// 오타 하나(부호 하나)가 실제보다 낙관적인 은퇴 계획을 만들어 내는 셈이라, 0으로 보정하는
// 대신(생활비 0도 마찬가지로 비현실적으로 낙관적이다) 입력 자체를 거부한다.
//
// 다른 음수 입력들은 이미 처리되어 있어 여기서 다루지 않는다:
//   - 수량/단가/월납입 음수: 엔진이 이미 0으로 수렴시키거나 무시한다
//   - 국민연금 음수: TaxEngine이 이미 예외를 던진다
//   - 수익률 음수: **정당한 비관 가정이므로 허용해야 한다**
describe('SimulationEngine 입력 검증 / 음수 목표 생활비', () => {
  const withSpending = (targetMonthlySpending: number) => retirementParams({
    userProfile: { ...retirementParams().userProfile, targetMonthlySpending },
  });

  test('음수 목표 생활비는 계산하지 않고 거부한다', () => {
    expect(() => new SimulationEngine().run(withSpending(-3_000_000)))
      .toThrow(InvalidSimulationInputError);
  });

  test('거부 메시지는 무엇이 잘못됐는지 밝힌다', () => {
    expect(() => new SimulationEngine().run(withSpending(-1)))
      .toThrow(/목표 생활비/);
  });

  test('0은 허용한다 — 음수와 달리 의미가 있는 입력이다', () => {
    expect(() => new SimulationEngine().run(withSpending(0))).not.toThrow();
  });

  test('정상 입력은 그대로 통과한다', () => {
    expect(() => new SimulationEngine().run(withSpending(5_000_000))).not.toThrow();
  });

  test('음수 수익률은 정당한 비관 가정이므로 거부하지 않는다', () => {
    const base = retirementParams();
    expect(() => new SimulationEngine().run({
      ...base,
      assets: [{ ...base.assets[0], totalReturn: -3 }],
    })).not.toThrow();
  });

  // run()만 막으면 확률 검증 경로가 뚫린다. 몬테카를로는 runSingle을 직접 부른다.
  test('몬테카를로 경로에서도 거부한다', () => {
    expect(() => runMonteCarlo(
      withSpending(-3_000_000),
      new SimulationEngine(),
      { trials: 5, seed: 1, annualStdDev: 10 },
    )).toThrow(InvalidSimulationInputError);
  });
});

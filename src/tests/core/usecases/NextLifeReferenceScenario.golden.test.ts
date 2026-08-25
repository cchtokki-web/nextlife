import { describe, expect, test } from 'vitest';
import auditCase from '@/tests/fixtures/auditReportCase.json';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';
import { resolveSpendingCurve } from '@/core/usecases/spending/spendingCurve';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { runMonteCarlo } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { computeSequenceRisk } from '@/core/usecases/montecarlo/sequenceRisk';

describe('51세·65세 은퇴·90세 저장소 기준 시나리오 golden', () => {
  // 사용자가 제시한 7.94억/6.25억 결과의 원본 E2EE 입력이 아니라, 저장소에 체크인된
  // auditReportCase를 65세 은퇴·90세 기대수명으로 정규화한 재구성 기준선이다.
  // 원본 입력이 확보되기 전에는 두 기준을 같다고 주장하거나 기대값을 임의 보정하지 않는다.
  const fixtureProvenance = 'repository_reconstruction' as const;
  const source = normalizeSimulationParams((auditCase as { params: unknown }).params);
  const params = {
    ...source,
    userProfile: {
      ...source.userProfile,
      retirementAge: 65,
      expectancy: 90,
      targetMonthlySpending: 3_000_000,
    },
    // 300 / 258 / 228만원의 현행 production 생활비 배분 프리셋.
    spendingCurve: resolveSpendingCurve('front_loaded'),
    // 이 golden은 결정론·MC 계산 경로를 고정한다. 옛 60세 HARD 목표가 65세 입력을
    // 다시 덮지 않게, UI에서 65세로 확정된 상태와 같은 값으로 맞춘다.
    retirementGoals: source.retirementGoals?.map((goal) => (
      goal.type === 'EARLY_RETIREMENT' ? { ...goal, targetValue: 65 } : goal
    )),
  };
  const engine = new SimulationEngine();

  test('결정론 결과와 80~90세 사적연금 지급을 고정한다', () => {
    expect(fixtureProvenance).toBe('repository_reconstruction');
    const result = engine.run(params);
    const at = (age: number) => result.yearlyResults.find((year) => year.age === age)!;

    // golden 수치는 계산식을 바꿀 때 의도적 승인 없이 움직이지 않도록 원 단위 대신
    // 표시 단위에 맞춘 허용폭으로 고정한다.
    expect(result.endingAssets).toBeCloseTo(937_968_737, -6);
    expect(at(65).spending / 12).toBeCloseTo(3_000_000, 0);
    expect(at(70).spending / 12).toBeCloseTo(2_580_000, 0);
    expect(at(80).spending / 12).toBeCloseTo(2_280_000, 0);
    expect(at(80).privatePensionIncome / 12).toBeCloseTo(373_500, 0);
    expect(at(90).privatePensionIncome / 12).toBeCloseTo(373_500, 0);

    for (const year of result.yearlyResults.filter((row) => row.age >= 80)) {
      const accountNet = year.privatePensionAccountLedgers!
        .reduce((sum, account) => sum + account.withdrawal, 0);
      expect(year.privatePensionIncome).toBeCloseTo(accountNet, 5);
    }
  });

  test('고정 seed Monte Carlo가 재현 가능하다', () => {
    const config = { trials: 1000, seed: 20260101, annualStdDev: 15 };
    const first = runMonteCarlo(params, engine, config);
    const second = runMonteCarlo(params, engine, config);

    expect(second.endingAssets).toEqual(first.endingAssets);
    expect(second.simulationSuccessRate).toBe(first.simulationSuccessRate);
    expect(first.trials).toBe(1000);
    expect(first.endingAssets.p50).toBeCloseTo(579_292_657, -6);
    expect(first.simulationSuccessRate).toBeCloseTo(0.978, 6);
  });

  test('Sequence Risk는 은퇴 후 나쁜 해가 먼저일 때 더 불리하다', () => {
    const sequence = computeSequenceRisk(params, engine, { seed: 20260101, annualStdDev: 15 });
    const ending = Object.fromEntries(sequence.cases.map((item) => [item.key, item.endingAssets]));

    expect(ending.worstFirst).toBeLessThan(ending.bestFirst);
    expect(sequence.orderingSpread).toBeGreaterThan(0);
    expect(ending.bestFirst).toBeCloseTo(3_038_602_332, -6);
    expect(ending.shuffled).toBeCloseTo(2_695_957_851, -6);
    expect(ending.worstFirst).toBeCloseTo(1_357_624_821, -6);
    expect(ending.earlyCrash).toBeCloseTo(1_770_065_574, -6);
  });
});

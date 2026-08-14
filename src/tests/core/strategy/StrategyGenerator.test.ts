import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { StrategyGenerator } from '@/core/strategy/StrategyGenerator';
import { initialParams } from '@/infrastructure/storage/localStore';

describe('StrategyGenerator', () => {
  test('현재 엔진이 지원하는 축만 bounded grid로 생성한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const before = structuredClone(input);

    const result = new StrategyGenerator().generate(input.profile, input.goals, input.strategy);

    expect(result.debug.theoreticalCombinationCount).toBe(648);
    expect(result.debug.generatedCandidateCount).toBe(648);
    expect(result.debug.cappedCandidateCount).toBe(0);
    expect(result.debug.axisSizes).toMatchObject({
      retirementAge: 8,
      nationalPensionStartAge: 3,
      withdrawalPolicy: 3,
      spendingPattern: 3,
      assetAllocation: 3,
    });
    expect(result.debug.omittedAxes.map((item) => item.axis)).toEqual([
      'privatePensionStartAge', 'cashBufferMonths', 'guardrail',
    ]);
    expect(result.candidates).toHaveLength(648);
    expect(input).toEqual(before);
  });

  test('후보 정책과 자산배분을 기존 엔진 필드 및 수익률 프리셋에 연결한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const result = new StrategyGenerator().generate(
      input.profile,
      input.goals,
      input.strategy,
      { maxCandidates: 1_000 },
    );
    const growth = result.candidates.find((candidate) =>
      candidate.dimensions.retirementAge === 58
      && candidate.dimensions.nationalPensionStartAge === 60
      && candidate.dimensions.withdrawalPolicy === 'PENSION_FIRST'
      && candidate.dimensions.spendingPattern === 'FRONT_LOADED'
      && candidate.dimensions.assetAllocation === 'GROWTH'
    );

    expect(growth).toBeDefined();
    expect(growth?.strategy.withdrawalPolicy.accountWithdrawalPolicy).toBe('PENSION_FIRST');
    expect(growth?.strategy.spendingPolicy.curve?.multipliers).toEqual([1.2, 1, 0.8]);
    expect(growth?.strategy.assetAllocation?.accountProjections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountKind: 'investment', annualReturn: 9 }),
        expect.objectContaining({ accountKind: 'private_pension', annualReturn: 6 }),
      ]),
    );
  });

  test('maxCandidates 제한과 잘린 후보 수를 debug에 남긴다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const result = new StrategyGenerator().generate(
      input.profile,
      input.goals,
      input.strategy,
      { maxCandidates: 25 },
    );

    expect(result.candidates).toHaveLength(25);
    expect(result.debug.cappedCandidateCount).toBe(623);
    expect(result.debug.theoreticalCombinationCount).toBe(
      result.debug.generatedCandidateCount + result.debug.cappedCandidateCount,
    );
  });

  test('효과가 없는 계좌 정책 축은 자동 축소한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.profile.assets = [];
    input.profile.pensions = input.profile.pensions.filter((pension) => pension.kind === 'national');
    input.profile.contributions = [];
    input.profile.hasIsaAccounts = false;

    const result = new StrategyGenerator().generate(input.profile, input.goals, {
      ...input.strategy,
      assetAllocation: { accountProjections: [] },
    });

    expect(result.debug.axisSizes.withdrawalPolicy).toBe(1);
    expect(result.debug.axisSizes.assetAllocation).toBe(1);
    expect(new Set(result.candidates.map((candidate) => candidate.dimensions.withdrawalPolicy)))
      .toEqual(new Set(['GENERAL_FIRST']));
  });

  test('이미 은퇴한 사용자는 과거의 seed 은퇴 나이를 유일한 후보로 보존한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.profile.personal.currentAge = 70;
    input.strategy.retirementAge = 60;

    const result = new StrategyGenerator().generate(input.profile, input.goals, input.strategy);

    expect(result.debug.axisSizes.retirementAge).toBe(1);
    expect(new Set(result.candidates.map((candidate) => candidate.strategy.retirementAge)))
      .toEqual(new Set([60]));
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  test('계획 종료가 국민연금 최소 개시 전이어도 기존 개시 나이 fallback으로 축을 유지한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.strategy.planHorizonAge = 59;
    input.strategy.retirementAge = 58;
    input.strategy.nationalPensionStartAge = 67;

    const result = new StrategyGenerator().generate(input.profile, input.goals, input.strategy);

    expect(result.debug.axisSizes.nationalPensionStartAge).toBe(1);
    expect(new Set(result.candidates.map((candidate) => candidate.strategy.nationalPensionStartAge)))
      .toEqual(new Set([67]));
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  test('고정 격자 밖의 사용자 조기은퇴 목표도 후보 나이로 포함한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{
      type: 'EARLY_RETIREMENT', priority: 1, targetValue: 57, constraintType: 'SOFT',
    }];

    const result = new StrategyGenerator().generate(input.profile, input.goals, input.strategy);

    expect(result.candidates.some((item) => item.strategy.retirementAge === 57)).toBe(true);
    expect(result.debug.axisSizes.retirementAge).toBe(9);
  });
});

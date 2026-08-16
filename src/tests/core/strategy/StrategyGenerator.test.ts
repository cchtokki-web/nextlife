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
    // 격자 648 + 현상 유지 1. 기본 시나리오의 현재 설정은 격자 위에 없다 —
    // 소비 모드·수익률 프리셋 반영 방식이 후보 생성 규칙과 어긋나기 때문이다.
    expect(result.debug.generatedCandidateCount).toBe(649);
    expect(result.debug.cappedCandidateCount).toBe(0);
    expect(result.debug.baselineDuplicateCount).toBe(0);
    expect(result.debug.baselineCandidateId).toBe('baseline');
    expect(result.debug.axisSizes).toMatchObject({
      retirementAge: 8,
      nationalPensionStartAge: 3,
      withdrawalPolicy: 3,
      spendingPattern: 3,
      assetAllocation: 3,
    });
    expect(result.debug.omittedAxes.map((item) => item.axis)).toEqual([
      'privatePensionStartAge', 'cashBufferMonths', 'guardrail', 'spendingPolicyMode',
    ]);
    expect(result.candidates).toHaveLength(649);
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
    expect(result.debug.cappedCandidateCount).toBe(624);
    // 현상 유지 후보 한 장이 격자 밖에서 더해지므로 총량은 격자보다 하나 많다. 그 한 장이
    // 격자 조합과 같으면 그쪽을 건너뛰어(baselineDuplicateCount) 합이 다시 맞는다.
    expect(result.debug.theoreticalCombinationCount + 1).toBe(
      result.debug.generatedCandidateCount
      + result.debug.cappedCandidateCount
      + result.debug.baselineDuplicateCount,
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

  // C5: 현재 나이 이전의 국민연금 개시 나이는 이미 지나간 선택이므로 후보가 될 수 없다.
  // 이 필터가 사라지면 60세 개시 후보가 63세 사용자에게도 생성되고, 조기수령 감액률만
  // 영구 적용된 채 순위에 오른다 — 오류 없이 잘못된 추천이 나온다.
  test('현재 나이 이전의 국민연금 개시 나이는 후보로 만들지 않는다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.profile.personal.currentAge = 63;
    input.strategy.retirementAge = 63;

    const result = new StrategyGenerator().generate(input.profile, input.goals, input.strategy);

    const startAges = new Set(
      result.candidates.map((candidate) => candidate.dimensions.nationalPensionStartAge),
    );
    expect(startAges.size).toBeGreaterThan(0);
    for (const age of startAges) {
      expect(age).toBeGreaterThanOrEqual(63);
    }
    // 60세(조기수령 최소 나이)는 이 사용자에게 선택지가 아니다.
    expect(startAges.has(60)).toBe(false);
  });

  // C6: 후보 비교 기준을 맞추기 위해 소비 모드를 target으로 고정하는 것은 의도된 동작이다.
  // 그 사실은 omittedAxes로 고지되지만, 동작 자체를 고정하는 테스트가 없었다.
  test('seed가 max_sustainable이어도 모든 격자 후보를 target 모드로 고정한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const seed = {
      ...input.strategy,
      spendingPolicy: { ...input.strategy.spendingPolicy, mode: 'max_sustainable' as const },
    };

    const result = new StrategyGenerator().generate(input.profile, input.goals, seed, {
      maxCandidates: 8,
    });

    const grid = result.candidates
      .filter((candidate) => candidate.id !== result.debug.baselineCandidateId);
    expect(grid.length).toBeGreaterThan(0);
    for (const candidate of grid) {
      expect(candidate.strategy.spendingPolicy.mode).toBe('target');
    }
  });
});

// 격자에 「아무것도 바꾸지 않는 안」이 없으면 argmax는 언제나 어떤 조정을 고르게 된다.
// 현재 계획이 이미 최선인 사용자에게도 바꿀 것을 권하게 되고, 그 권고가 실제로는 손해인지
// 아닌지를 판별할 기준선 자체가 후보 목록에 없다. 같은 결함을 usecases 계통의
// RecommendationEngine은 이미 고쳤고(topCandidates에 plan: null 포함), 이쪽에 남아 있었다.
describe('StrategyGenerator 현상 유지 후보', () => {
  test('격자가 만들 수 없는 설정이어도 seed 그대로의 후보를 포함한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    // 두 설정 모두 격자 축이 표현하지 못한다 — 인출정책 축은 PROPORTIONAL을 제외하고,
    // 소비 모드 축은 모든 후보를 target으로 고정한다.
    const seed = {
      ...input.strategy,
      withdrawalPolicy: { ...input.strategy.withdrawalPolicy, accountWithdrawalPolicy: 'PROPORTIONAL' as const },
      spendingPolicy: { ...input.strategy.spendingPolicy, mode: 'max_sustainable' as const },
    };
    const before = structuredClone(seed);

    const result = new StrategyGenerator().generate(input.profile, input.goals, seed);

    const baseline = result.candidates.find((item) => item.id === result.debug.baselineCandidateId);
    expect(baseline).toBeDefined();
    expect(baseline?.strategy).toEqual(before);
    expect(baseline?.dimensions.withdrawalPolicy).toBe('PROPORTIONAL');
    // seed를 훼손하지 않는다.
    expect(seed).toEqual(before);
  });

  test('현상 유지 후보는 maxCandidates 상한에도 잘리지 않는다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));

    const result = new StrategyGenerator().generate(input.profile, input.goals, input.strategy, {
      maxCandidates: 1,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].id).toBe(result.debug.baselineCandidateId);
  });

  test('seed가 이미 격자 위에 있으면 같은 조합을 두 번 만들지 않는다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    // 격자가 실제로 만들어 내는 조합 하나를 그대로 seed로 되먹인다.
    const probe = new StrategyGenerator().generate(input.profile, input.goals, input.strategy);
    const onGrid = probe.candidates.find((item) => item.id === 'retire-62|np-65|GENERAL_FIRST|FIXED|BALANCED');
    expect(onGrid).toBeDefined();

    const result = new StrategyGenerator().generate(input.profile, input.goals, onGrid!.strategy);

    const identical = result.candidates
      .filter((item) => JSON.stringify(item.strategy) === JSON.stringify(onGrid!.strategy));
    expect(identical).toHaveLength(1);
    expect(result.debug.baselineDuplicateCount).toBe(1);
    expect(result.debug.baselineCandidateId).toBe(identical[0].id);
  });
});

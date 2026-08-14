import { describe, expect, test } from 'vitest';
import { simulateLegacyConfig } from '@/core/application/simulateLegacyConfig';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import type { SimulationEngine } from '@/core/simulation/SimulationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';
import { allAxesLiveParams } from '@/tests/fixtures/allAxesLiveParams';

describe('new simulation boundary over the legacy engine', () => {
  test('legacy config adapter round-trips without changing or mutating persisted input', () => {
    const legacyConfig = structuredClone(initialParams);
    const before = structuredClone(legacyConfig);
    const compiled = compileStrategy(legacyConfig);

    const { profile, goals, strategy } = LegacySimulationAdapter.fromLegacy(
      legacyConfig,
      compiled.utilityConfig
    );

    expect(LegacySimulationAdapter.toLegacy(profile, goals, strategy)).toEqual(legacyConfig);
    expect(legacyConfig).toEqual(before);
  });

  test('FACT, GOAL, and STRATEGY stay separate while all optional legacy fields round-trip', () => {
    const legacyConfig = structuredClone({
      ...allAxesLiveParams,
      userProfile: {
        ...allAxesLiveParams.userProfile,
        targetBequest: 250_000_000,
      },
      assets: allAxesLiveParams.assets.map((asset, index) => ({
        ...asset,
        contributionPeriod: 'weekly' as const,
        contributionAmount: 25_000 + index,
        reinvestDividend: index === 0,
      })),
      privatePensions: allAxesLiveParams.privatePensions.map((pension) => ({
        ...pension,
        dividendYield: 1.5,
        earlyChannelingEnabled: true,
      })),
      spendingStrategy: 'target' as const,
      spendingCurve: { breakpointAges: [70], multipliers: [1, 0.8] },
      assetFloor: 100_000_000,
      withdrawalPlan: {
        nationalPensionStartAge: 67,
        privatePensionMonthlyTarget: 1_000_000,
        assetSellOrderStrategy: 'low_dividend_first' as const,
        isaMaturityDestination: 'asset' as const,
        generalAssetWithdrawalStartAge: 62,
        monthlySpendingMultiplier: 0.95,
      },
    });

    const input = LegacySimulationAdapter.fromLegacy(legacyConfig);

    expect(input.profile.personal).toEqual({ currentAge: 55 });
    expect(input.goals.goals).toEqual([
      { type: 'retirement_age', targetAge: 61 },
      { type: 'monthly_spending', monthlyAmount: 3_000_000 },
      { type: 'plan_horizon', targetAge: 95 },
      { type: 'bequest', targetAmount: 250_000_000 },
    ]);
    expect(input.strategy.nationalPensionStartAge).toBe(67);
    expect(input.strategy.withdrawalPolicy).not.toHaveProperty('nationalPensionStartAge');
    expect(input.strategy.contributionPolicy?.privatePensionEarlyChanneling).toEqual([
      { accountId: 'pension-1', enabled: true },
    ]);
    expect(LegacySimulationAdapter.toLegacy(input.profile, input.goals, input.strategy))
      .toEqual(legacyConfig);
  });

  test('goal and selected strategy retirement ages can differ without changing legacy semantics', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const retirementGoal = input.goals.goals.find((goal) => goal.type === 'retirement_age');
    if (!retirementGoal || retirementGoal.type !== 'retirement_age') {
      throw new Error('retirement age goal fixture is missing');
    }
    retirementGoal.targetAge = 60;
    input.strategy.retirementAge = 63;

    const legacy = LegacySimulationAdapter.toLegacy(input.profile, input.goals, input.strategy);

    expect(legacy.userProfile.retirementAge).toBe(63);
  });

  test('named strategy policies are the source for legacy execution settings', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.strategy.nationalPensionStartAge = 68;
    input.strategy.spendingPolicy.mode = 'dividend_only';
    input.strategy.withdrawalPolicy.assetSellOrderStrategy = 'high_dividend_first';

    const legacy = LegacySimulationAdapter.toLegacy(input.profile, input.goals, input.strategy);

    expect(legacy.spendingStrategy).toBe('dividend_only');
    expect(legacy.withdrawalPlan).toEqual({
      nationalPensionStartAge: 68,
      assetSellOrderStrategy: 'high_dividend_first',
    });
  });

  test('profile contributions are the single source for every legacy account contribution', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(allAxesLiveParams));
    const investment = input.profile.contributions.find(
      (plan) => plan.accountKind === 'investment' && plan.accountId === 'a1'
    );
    const pension = input.profile.contributions.find(
      (plan) => plan.accountKind === 'private_pension' && plan.accountId === 'pension-1'
    );
    const isa = input.profile.contributions.find(
      (plan) => plan.accountKind === 'isa' && plan.accountId === 'isa-1'
    );
    if (!investment || !pension || !isa) throw new Error('contribution fixture is incomplete');

    investment.monthlyAmount = 111_000;
    investment.period = 'weekly';
    investment.periodicAmount = 22_000;
    pension.monthlyAmount = 333_000;
    isa.monthlyAmount = 444_000;

    const legacy = LegacySimulationAdapter.toLegacy(input.profile, input.goals, input.strategy);

    expect(legacy.assets[0]).toMatchObject({
      monthlyContribution: 111_000,
      contributionPeriod: 'weekly',
      contributionAmount: 22_000,
    });
    expect(legacy.privatePensions[0].monthlyContribution).toBe(333_000);
    expect(legacy.isaAccounts?.[0].monthlyContribution).toBe(444_000);
  });

  test('changing a domain contribution changes the simulation result', () => {
    const engine: SimulationEngine = new LegacySimulationEngine();
    const baseline = LegacySimulationAdapter.fromLegacy(structuredClone(allAxesLiveParams));
    const changed = LegacySimulationAdapter.fromLegacy(structuredClone(allAxesLiveParams));
    const investment = changed.profile.contributions.find(
      (plan) => plan.accountKind === 'investment' && plan.accountId === 'a1'
    );
    if (!investment) throw new Error('investment contribution fixture is missing');
    investment.monthlyAmount = 1_000_000;

    const baselineResult = engine.simulate(baseline.profile, baseline.goals, baseline.strategy);
    const changedResult = engine.simulate(changed.profile, changed.goals, changed.strategy);

    expect(changedResult.yearlyResults[0].totalAssets)
      .toBeGreaterThan(baselineResult.yearlyResults[0].totalAssets);
  });

  test('missing contribution plans fail instead of silently using duplicated account values', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.profile.contributions = input.profile.contributions.filter(
      (plan) => !(plan.accountKind === 'investment' && plan.accountId === 'asset-kodex200')
    );

    expect(() => LegacySimulationAdapter.toLegacy(input.profile, input.goals, input.strategy))
      .toThrow('Missing contribution plan: investment/asset-kodex200');
  });

  test('simulate(profile, goals, strategy) is exactly equal to the pre-refactor run result', () => {
    const legacyEngine = new LegacySimulationEngine();
    const compiled = compileStrategy(structuredClone(initialParams));
    const before = legacyEngine.run(compiled.params, compiled.utilityConfig);
    const { profile, goals, strategy } = LegacySimulationAdapter.fromLegacy(
      compiled.params,
      compiled.utilityConfig
    );

    const engine: SimulationEngine = legacyEngine;
    const after = engine.simulate(profile, goals, strategy);

    expect(after).toEqual(before);
  });

  test('application entry point runs without React or browser state', () => {
    const engine: SimulationEngine = new LegacySimulationEngine();
    const compiled = compileStrategy(structuredClone(initialParams));

    const result = simulateLegacyConfig(engine, compiled.params, compiled.utilityConfig);

    expect(result.yearlyResults.length).toBeGreaterThan(0);
    expect(result.yearlyResults[0].age).toBe(compiled.params.userProfile.currentAge);
    expect(result.yearlyResults.at(-1)?.age).toBe(compiled.params.userProfile.expectancy);
  });
});

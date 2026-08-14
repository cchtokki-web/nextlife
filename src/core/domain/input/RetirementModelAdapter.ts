import type {
  InvestmentAsset,
  IsaAccount,
  PrivatePension,
  UtilityConfig,
} from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from '../../usecases/utility/utilityWeights';
import type {
  AssetAccount,
  ContributionPlan,
  LegacySimulationConfig,
  PensionProfile,
  RetirementGoal,
  RetirementGoals,
  RetirementProfile,
  RetirementSimulationInput,
  RetirementStrategy,
} from './retirement';

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function goalsFromLegacy(config: LegacySimulationConfig): RetirementGoals {
  const goals: RetirementGoal[] = [
    { type: 'retirement_age', targetAge: config.userProfile.retirementAge },
    { type: 'monthly_spending', monthlyAmount: config.userProfile.targetMonthlySpending },
    { type: 'plan_horizon', targetAge: config.userProfile.expectancy },
  ];
  if (hasOwn(config.userProfile, 'targetBequest')) {
    goals.push({ type: 'bequest', targetAmount: config.userProfile.targetBequest as number });
  }
  return { goals };
}

function requiredGoal<T extends RetirementGoal['type']>(
  goals: RetirementGoals,
  type: T
): Extract<RetirementGoal, { type: T }> {
  const goal = goals.goals.find(
    (candidate): candidate is Extract<RetirementGoal, { type: T }> => candidate.type === type
  );
  if (!goal) throw new Error(`Missing required retirement goal: ${type}`);
  return goal;
}

function contributionsFromLegacy(config: LegacySimulationConfig): ContributionPlan[] {
  return [
    ...config.assets.map((account): ContributionPlan => ({
      accountKind: 'investment',
      accountId: account.id,
      monthlyAmount: account.monthlyContribution,
      ...(hasOwn(account, 'contributionPeriod') ? { period: account.contributionPeriod } : {}),
      ...(hasOwn(account, 'contributionAmount') ? { periodicAmount: account.contributionAmount } : {}),
    })),
    ...config.privatePensions.map((account): ContributionPlan => ({
      accountKind: 'private_pension',
      accountId: account.id,
      monthlyAmount: account.monthlyContribution,
    })),
    ...(config.isaAccounts ?? []).map((account): ContributionPlan => ({
      accountKind: 'isa',
      accountId: account.id,
      monthlyAmount: account.monthlyContribution,
    })),
  ];
}

function requiredContribution(
  profile: RetirementProfile,
  accountKind: ContributionPlan['accountKind'],
  accountId: string
): ContributionPlan {
  const contribution = profile.contributions.find(
    (candidate) => candidate.accountKind === accountKind && candidate.accountId === accountId
  );
  if (!contribution) {
    throw new Error(`Missing contribution plan: ${accountKind}/${accountId}`);
  }
  return contribution;
}

/** Lossless boundary from persisted settings to FACT / GOAL / STRATEGY models. */
export class RetirementModelAdapter {
  static fromLegacy(
    config: LegacySimulationConfig,
    utilityConfig: UtilityConfig = DEFAULT_UTILITY_CONFIG
  ): RetirementSimulationInput {
    const pensions: PensionProfile[] = [
      { kind: 'national', account: config.nationalPension },
      ...config.privatePensions.map((pension): PensionProfile => {
        const { monthlyContribution: _monthlyContribution, annualReturn: _annualReturn,
          dividendYield: _dividendYield, earlyChannelingEnabled: _earlyChannelingEnabled,
          ...account } = pension;
        return { kind: 'private', account };
      }),
    ];

    const assets: AssetAccount[] = [
      ...config.assets.map((asset): AssetAccount => {
        const { monthlyContribution: _monthlyContribution, contributionPeriod: _contributionPeriod,
          contributionAmount: _contributionAmount, annualGrowthRate: _annualGrowthRate,
          dividendYield: _dividendYield, reinvestDividend: _reinvestDividend, ...account } = asset;
        return { kind: 'investment', account };
      }),
      ...(config.isaAccounts ?? []).map((isa): AssetAccount => {
        const { monthlyContribution: _monthlyContribution, annualReturn: _annualReturn,
          dividendYield: _dividendYield, ...account } = isa;
        return { kind: 'isa', account };
      }),
    ];

    const {
      userProfile: _userProfile,
      assets: _assets,
      nationalPension: _nationalPension,
      privatePensions: _privatePensions,
      isaAccounts: _isaAccounts,
      otherIncomes: _otherIncomes,
      spendingStrategy: _spendingStrategy,
      spendingCurve: _spendingCurve,
      assetFloor: _assetFloor,
      withdrawalPlan: _withdrawalPlan,
      ...legacySettings
    } = config;

    const profile: RetirementProfile = {
      personal: { currentAge: config.userProfile.currentAge },
      household: {},
      income: { otherIncomes: config.otherIncomes },
      pensions,
      assets,
      contributions: contributionsFromLegacy(config),
      hasIsaAccounts: hasOwn(config, 'isaAccounts'),
    };

    const strategy: RetirementStrategy = {
      retirementAge: config.userProfile.retirementAge,
      ...(config.withdrawalPlan?.nationalPensionStartAge !== undefined
        ? { nationalPensionStartAge: config.withdrawalPlan.nationalPensionStartAge }
        : {}),
      withdrawalPolicy: {
        ...Object.fromEntries(
          Object.entries(config.withdrawalPlan ?? {}).filter(([key]) => key !== 'nationalPensionStartAge')
        ),
        ...(hasOwn(config, 'assetFloor') ? { assetFloor: config.assetFloor } : {}),
      } as RetirementStrategy['withdrawalPolicy'],
      spendingPolicy: {
        ...(hasOwn(config, 'spendingStrategy') ? { mode: config.spendingStrategy } : {}),
        ...(hasOwn(config, 'spendingCurve') ? { curve: config.spendingCurve } : {}),
      },
      assetAllocation: {
        accountProjections: [
          ...config.assets.map((asset) => ({
            accountKind: 'investment' as const,
            accountId: asset.id,
            annualReturn: asset.annualGrowthRate,
            dividendYield: asset.dividendYield,
            reinvestDividend: asset.reinvestDividend,
          })),
          ...config.privatePensions.map((pension) => ({
            accountKind: 'private_pension' as const,
            accountId: pension.id,
            annualReturn: pension.annualReturn,
            ...(hasOwn(pension, 'dividendYield') ? { dividendYield: pension.dividendYield } : {}),
          })),
          ...(config.isaAccounts ?? []).map((isa) => ({
            accountKind: 'isa' as const,
            accountId: isa.id,
            annualReturn: isa.annualReturn,
            dividendYield: isa.dividendYield,
          })),
        ],
      },
      contributionPolicy: {
        privatePensionEarlyChanneling: config.privatePensions.flatMap((pension) =>
          hasOwn(pension, 'earlyChannelingEnabled')
            ? [{ accountId: pension.id, enabled: pension.earlyChannelingEnabled as boolean }]
            : []
        ),
      },
      legacySettings,
      legacyPresence: {
        withdrawalPlan: hasOwn(config, 'withdrawalPlan'),
        spendingStrategy: hasOwn(config, 'spendingStrategy'),
        spendingCurve: hasOwn(config, 'spendingCurve'),
        assetFloor: hasOwn(config, 'assetFloor'),
      },
      utilityConfig,
    };

    return { profile, goals: goalsFromLegacy(config), strategy };
  }

  static toLegacy(
    profile: RetirementProfile,
    goals: RetirementGoals,
    strategy: RetirementStrategy
  ): LegacySimulationConfig {
    const retirementAge = requiredGoal(goals, 'retirement_age');
    const monthlySpending = requiredGoal(goals, 'monthly_spending');
    const horizon = requiredGoal(goals, 'plan_horizon');
    const bequest = goals.goals.find(
      (goal): goal is Extract<RetirementGoal, { type: 'bequest' }> => goal.type === 'bequest'
    );

    const nationalPension = profile.pensions.find(
      (pension): pension is Extract<PensionProfile, { kind: 'national' }> => pension.kind === 'national'
    );
    if (!nationalPension) throw new Error('Missing national pension profile');

    const projections = strategy.assetAllocation?.accountProjections ?? [];
    const privateEarly = new Map(
      strategy.contributionPolicy?.privatePensionEarlyChanneling.map((item) => [item.accountId, item.enabled])
    );

    const assets: InvestmentAsset[] = profile.assets
      .filter((asset): asset is Extract<AssetAccount, { kind: 'investment' }> => asset.kind === 'investment')
      .map(({ account }) => {
        const contribution = requiredContribution(profile, 'investment', account.id);
        const projection = projections.find(
          (item) => item.accountKind === 'investment' && item.accountId === account.id
        );
        if (!projection || projection.accountKind !== 'investment') {
          throw new Error(`Missing investment projection: ${account.id}`);
        }
        return {
          ...account,
          monthlyContribution: contribution.monthlyAmount,
          ...(hasOwn(contribution, 'period') ? { contributionPeriod: contribution.period } : {}),
          ...(hasOwn(contribution, 'periodicAmount')
            ? { contributionAmount: contribution.periodicAmount }
            : {}),
          annualGrowthRate: projection.annualReturn,
          dividendYield: projection.dividendYield,
          reinvestDividend: projection.reinvestDividend,
        };
      });

    const privatePensions: PrivatePension[] = profile.pensions
      .filter((pension): pension is Extract<PensionProfile, { kind: 'private' }> => pension.kind === 'private')
      .map(({ account }) => {
        const contribution = requiredContribution(profile, 'private_pension', account.id);
        const projection = projections.find(
          (item) => item.accountKind === 'private_pension' && item.accountId === account.id
        );
        if (!projection || projection.accountKind !== 'private_pension') {
          throw new Error(`Missing private pension projection: ${account.id}`);
        }
        return {
          ...account,
          monthlyContribution: contribution.monthlyAmount,
          annualReturn: projection.annualReturn,
          ...(hasOwn(projection, 'dividendYield') ? { dividendYield: projection.dividendYield } : {}),
          ...(privateEarly.has(account.id) ? { earlyChannelingEnabled: privateEarly.get(account.id) } : {}),
        };
      });

    const isaAccounts: IsaAccount[] = profile.assets
      .filter((asset): asset is Extract<AssetAccount, { kind: 'isa' }> => asset.kind === 'isa')
      .map(({ account }) => {
        const contribution = requiredContribution(profile, 'isa', account.id);
        const projection = projections.find(
          (item) => item.accountKind === 'isa' && item.accountId === account.id
        );
        if (!projection || projection.accountKind !== 'isa') {
          throw new Error(`Missing ISA projection: ${account.id}`);
        }
        return {
          ...account,
          monthlyContribution: contribution.monthlyAmount,
          annualReturn: projection.annualReturn,
          dividendYield: projection.dividendYield,
        };
      });

    const { assetFloor, ...withdrawalPolicy } = strategy.withdrawalPolicy;
    const withdrawalPlan = {
      ...withdrawalPolicy,
      ...(strategy.nationalPensionStartAge !== undefined
        ? { nationalPensionStartAge: strategy.nationalPensionStartAge }
        : {}),
    };

    return {
      userProfile: {
        currentAge: profile.personal.currentAge,
        retirementAge: strategy.retirementAge ?? retirementAge.targetAge,
        expectancy: horizon.targetAge,
        targetMonthlySpending: monthlySpending.monthlyAmount,
        ...(bequest ? { targetBequest: bequest.targetAmount } : {}),
      },
      assets,
      nationalPension: nationalPension.account,
      privatePensions,
      ...(profile.hasIsaAccounts || isaAccounts.length > 0 ? { isaAccounts } : {}),
      otherIncomes: profile.income.otherIncomes,
      ...strategy.legacySettings,
      ...(strategy.legacyPresence.spendingStrategy || strategy.spendingPolicy.mode !== undefined
        ? { spendingStrategy: strategy.spendingPolicy.mode }
        : {}),
      ...(strategy.legacyPresence.spendingCurve || strategy.spendingPolicy.curve !== undefined
        ? { spendingCurve: strategy.spendingPolicy.curve }
        : {}),
      ...(strategy.legacyPresence.assetFloor || assetFloor !== undefined ? { assetFloor } : {}),
      ...(strategy.legacyPresence.withdrawalPlan || Object.keys(withdrawalPlan).length > 0
        ? { withdrawalPlan }
        : {}),
    };
  }
}

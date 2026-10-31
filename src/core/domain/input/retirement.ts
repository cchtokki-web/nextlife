import type {
  InvestmentAsset,
  IsaAccount,
  NationalPension,
  OtherIncome,
  PrivatePension,
  SimulationParams,
  SpendingCurve,
  SpendingStrategy,
  UtilityConfig,
  WithdrawalPlan,
} from '../../entities/types';
import type { RetirementGoal as SelectedRetirementGoal } from '../../entities/retirementGoal';

/** Persisted simulator input kept for saved scenarios and existing API callers. */
export type LegacySimulationConfig = SimulationParams;

export interface PersonalProfile {
  currentAge: number;
}

/** SimulationParams has no household member fields yet. Do not invent spouse data here. */
export interface HouseholdProfile {
  spouse?: PersonalProfile;
}

export interface IncomeProfile {
  otherIncomes: OtherIncome[];
}

export type PrivatePensionAccount = Omit<
  PrivatePension,
  'monthlyContribution' | 'totalReturn' | 'dividendYield' | 'earlyChannelingEnabled'
>;

export type PensionProfile =
  | { kind: 'national'; account: NationalPension }
  | { kind: 'private'; account: PrivatePensionAccount };

export type AssetAccount =
  | {
      kind: 'investment';
      account: Omit<
        InvestmentAsset,
        | 'monthlyContribution'
        | 'contributionPeriod'
        | 'contributionAmount'
        | 'totalReturn'
        | 'dividendYield'
        | 'reinvestDividend'
      >;
    }
  | {
      kind: 'isa';
      account: Omit<IsaAccount, 'monthlyContribution' | 'totalReturn' | 'dividendYield'>;
    };

/** Existing recurring deposits are FACTs about the user's current plan. */
export interface ContributionPlan {
  accountKind: 'investment' | 'private_pension' | 'isa';
  accountId: string;
  monthlyAmount: number;
  period?: InvestmentAsset['contributionPeriod'];
  periodicAmount?: number;
}

/** Current facts only. Desired outcomes and execution choices live outside this object. */
export interface RetirementProfile {
  personal: PersonalProfile;
  household: HouseholdProfile;
  income: IncomeProfile;
  pensions: PensionProfile[];
  assets: AssetAccount[];
  contributions: ContributionPlan[];
  /** Preserves the distinction between an omitted legacy ISA list and an explicitly empty one. */
  hasIsaAccounts: boolean;
}

export type RetirementGoal =
  | { type: 'retirement_age'; targetAge: number }
  | { type: 'monthly_spending'; monthlyAmount: number }
  | { type: 'plan_horizon'; targetAge: number }
  | { type: 'bequest'; targetAmount: number };

/** Required legacy engine goals plus the optional maximum-five user selection. */
export interface RetirementGoals {
  goals: RetirementGoal[];
  /** User-selected, prioritized goals introduced by the goal-based input flow. */
  selectedGoals?: SelectedRetirementGoal[];
}

export interface WithdrawalPolicy extends Omit<WithdrawalPlan, 'nationalPensionStartAge'> {
  assetFloor?: number;
}

export interface SpendingPolicy {
  mode?: SpendingStrategy;
  curve?: SpendingCurve;
}

export type AccountProjection =
  | {
      accountKind: 'investment';
      accountId: string;
      totalReturn: number;
      dividendYield: number;
      reinvestDividend: boolean;
    }
  | {
      accountKind: 'private_pension';
      accountId: string;
      totalReturn: number;
      dividendYield?: number;
    }
  | {
      accountKind: 'isa';
      accountId: string;
      totalReturn: number;
      dividendYield: number;
    };

export interface AssetAllocationPolicy {
  accountProjections: AccountProjection[];
}

export interface ContributionPolicy {
  privatePensionEarlyChanneling: Array<{
    accountId: string;
    enabled: boolean;
  }>;
}

type LegacyStrategySettings = Omit<
  SimulationParams,
  | 'userProfile'
  | 'assets'
  | 'nationalPension'
  | 'privatePensions'
  | 'isaAccounts'
  | 'otherIncomes'
  | 'retirementGoals'
  | 'spendingStrategy'
  | 'spendingCurve'
  | 'assetFloor'
  | 'withdrawalPlan'
>;

/**
 * System-controlled execution choices and calculation assumptions.
 *
 * `legacySettings` is the compatibility payload used by the legacy engine. The named policy
 * projections make the new boundary explicit without changing any existing formula or default.
 */
export interface RetirementStrategy {
  /** Concrete spending target evaluated by the simulation (display-currency amount per month). */
  targetMonthlySpending: number;
  /** Last age included in the deterministic projection. */
  planHorizonAge: number;
  /** Optional amount the applied strategy intends to leave at the projection horizon. */
  targetBequest?: number;
  /** Explicit calendar-year anchor; keeps the same profile/strategy input deterministic. */
  simulationStartYear: number;
  retirementAge: number;
  nationalPensionStartAge?: number;
  privatePensionStartAge?: number;
  withdrawalPolicy: WithdrawalPolicy;
  spendingPolicy: SpendingPolicy;
  assetAllocation?: AssetAllocationPolicy;
  cashBufferMonths?: number;
  contributionPolicy?: ContributionPolicy;
  legacySettings: LegacyStrategySettings;
  legacyPresence: {
    withdrawalPlan: boolean;
    spendingStrategy: boolean;
    spendingCurve: boolean;
    assetFloor: boolean;
  };
  utilityConfig: UtilityConfig;
}

export interface RetirementSimulationInput {
  profile: RetirementProfile;
  goals: RetirementGoals;
  strategy: RetirementStrategy;
}

export type LegacyFieldCategory = 'FACT' | 'GOAL' | 'STRATEGY';

/** Exhaustive top-level classification; mixed `userProfile` fields are split by the adapter. */
export const LEGACY_SIMULATION_FIELD_CLASSIFICATION = {
  investmentBaseline: 'FACT',
  userProfile: 'GOAL',
  retirementGoals: 'GOAL',
  assets: 'FACT',
  nationalPension: 'FACT',
  privatePensions: 'FACT',
  isaAccounts: 'FACT',
  otherIncomes: 'FACT',
  inflationRate: 'STRATEGY',
  inflationMode: 'STRATEGY',
  baseExchangeRate: 'STRATEGY',
  exchangeScenario: 'STRATEGY',
  displayCurrency: 'STRATEGY',
  useLatestExchangeRate: 'STRATEGY',
  yieldPreset: 'STRATEGY',
  customYieldSnapshot: 'STRATEGY',
  spendingStrategy: 'STRATEGY',
  spendingCurve: 'STRATEGY',
  assetFloor: 'STRATEGY',
  hardSpendingFloor: 'STRATEGY',
  cashYieldRate: 'STRATEGY',
  taxSettings: 'STRATEGY',
  withdrawalPlan: 'STRATEGY',
  strategy: 'STRATEGY',
  healthcare: 'STRATEGY',
  taxLawVersion: 'STRATEGY',
} as const satisfies Record<keyof SimulationParams, LegacyFieldCategory>;

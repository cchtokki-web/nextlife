import type {
  SimulationParams,
  UtilityConfig,
} from '../../entities/types';

/**
 * The persisted simulator input before the goal-based domain was introduced.
 * Keep this alias while saved scenarios and API contracts still use SimulationParams.
 */
export type LegacySimulationConfig = SimulationParams;

/** Current personal, family, income, and asset state used by every strategy. */
export type RetirementProfile = Pick<
  SimulationParams,
  | 'userProfile'
  | 'assets'
  | 'nationalPension'
  | 'privatePensions'
  | 'isaAccounts'
  | 'otherIncomes'
>;

/**
 * A simulation strategy and its assumptions, separated from the user's current state.
 *
 * This phase deliberately carries every legacy option without interpreting or changing it.
 * Later goal-based strategy generation can replace this shape behind the SimulationEngine
 * interface without changing the UI or the legacy persistence contract.
 */
export type RetirementStrategy = Omit<SimulationParams, keyof RetirementProfile> & {
  utilityConfig: UtilityConfig;
};

export interface RetirementSimulationInput {
  profile: RetirementProfile;
  strategy: RetirementStrategy;
}

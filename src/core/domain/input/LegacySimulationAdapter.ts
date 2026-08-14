import type { UtilityConfig } from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from '../../usecases/utility/utilityWeights';
import type {
  LegacySimulationConfig,
  RetirementProfile,
  RetirementSimulationInput,
  RetirementStrategy,
} from './retirement';

/** Lossless boundary between persisted SimulationParams and the new domain input. */
export class LegacySimulationAdapter {
  static fromLegacy(
    config: LegacySimulationConfig,
    utilityConfig: UtilityConfig = DEFAULT_UTILITY_CONFIG
  ): RetirementSimulationInput {
    const {
      userProfile,
      assets,
      nationalPension,
      privatePensions,
      isaAccounts,
      otherIncomes,
      ...legacyStrategy
    } = config;

    const profile: RetirementProfile = {
      userProfile,
      assets,
      nationalPension,
      privatePensions,
      ...(Object.prototype.hasOwnProperty.call(config, 'isaAccounts') ? { isaAccounts } : {}),
      otherIncomes,
    };

    const strategy: RetirementStrategy = {
      ...legacyStrategy,
      utilityConfig,
    };

    return { profile, strategy };
  }

  static toLegacy(
    profile: RetirementProfile,
    strategy: RetirementStrategy
  ): LegacySimulationConfig {
    const { utilityConfig: _utilityConfig, ...legacyStrategy } = strategy;
    return { ...profile, ...legacyStrategy };
  }
}

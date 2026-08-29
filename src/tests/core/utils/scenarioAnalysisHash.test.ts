import { describe, expect, it } from 'vitest';
import { scenarioAnalysisHash } from '@/core/utils/scenarioAnalysisHash';
import type { SimulationParams } from '@/core/entities/types';

const params = { userProfile: { currentAge: 45, lifeExpectancy: 90 } } as SimulationParams;

describe('scenarioAnalysisHash', () => {
  it('returns the same hash for equivalent objects with different key order', () => {
    expect(scenarioAnalysisHash(params)).toBe(
      scenarioAnalysisHash({ userProfile: { lifeExpectancy: 90, currentAge: 45 } } as SimulationParams),
    );
  });

  it('changes when an analysis input changes', () => {
    expect(scenarioAnalysisHash(params)).not.toBe(
      scenarioAnalysisHash({ userProfile: { currentAge: 46, lifeExpectancy: 90 } } as SimulationParams),
    );
  });
});

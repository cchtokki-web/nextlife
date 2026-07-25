import { CompleteWithdrawalPlan, SimulationParams, SimulationResult, UtilityBreakdown, UtilityConfig } from '../../entities/types';
import { SimulationEngine } from '../SimulationEngine';
import { computeLifetimeUtility } from '../utility/UtilityEngine';
import { getIdentityPlan } from './StrategyCandidateGenerator';

export interface DividendReinvestmentPerAssetResult {
  assetId: string;
  assetName: string;
  flippedValue: boolean;
  utilityDelta: number;
  individualResult: SimulationResult;
}

export interface DividendReinvestmentOptimizationResult {
  recommendedAssetReinvestment: Record<string, boolean> | null;
  perAssetResults: DividendReinvestmentPerAssetResult[];
  finalResult: SimulationResult;
  finalUtility: UtilityBreakdown;
}

function buildParamsWithReinvestmentOverrides(
  params: SimulationParams,
  plan: CompleteWithdrawalPlan,
  overrides: Record<string, boolean>
): SimulationParams {
  return {
    ...params,
    withdrawalPlan: plan,
    assets: params.assets.map((a) => (a.id in overrides ? { ...a, reinvestDividend: overrides[a.id] } : a)),
  };
}

function noOpResult(bestResult: SimulationResult, bestUtility: UtilityBreakdown): DividendReinvestmentOptimizationResult {
  return {
    recommendedAssetReinvestment: null,
    perAssetResults: [],
    finalResult: bestResult,
    finalUtility: bestUtility,
  };
}

// bestPlan/bestResult/bestUtility(Phase 1+2 결과) 기준으로 자산별 reinvestDividend 반전을
// 독립 평가(O(N), 자산 N개 -> N번 시뮬레이션)하고, 유리한 자산들을 한꺼번에 적용한 조합을
// 한 번 더 검증한다(자산 간 비가산적 상호작용에 대한 안전장치). 개선이 없으면 완전한 no-op을
// 반환해(finalResult===bestResult, finalUtility===bestUtility) 호출부가 항상 동일한 형태로
// 값을 소비할 수 있게 한다.
export function optimizeDividendReinvestment(
  params: SimulationParams,
  bestPlan: CompleteWithdrawalPlan | null,
  bestResult: SimulationResult,
  bestUtility: UtilityBreakdown,
  engine: SimulationEngine,
  cfg: UtilityConfig
): DividendReinvestmentOptimizationResult {
  if (params.assets.length === 0) return noOpResult(bestResult, bestUtility);

  const plan = bestPlan ?? getIdentityPlan(params);
  const beneficial: DividendReinvestmentPerAssetResult[] = [];

  for (const asset of params.assets) {
    const flippedValue = !asset.reinvestDividend;
    try {
      const candidateParams = buildParamsWithReinvestmentOverrides(params, plan, { [asset.id]: flippedValue });
      const candidateResult = engine.runForUtility(candidateParams);
      const candidateUtility = computeLifetimeUtility(candidateResult, candidateParams, cfg);
      if (candidateUtility.score > bestUtility.score) {
        beneficial.push({
          assetId: asset.id,
          assetName: asset.name,
          flippedValue,
          utilityDelta: candidateUtility.score - bestUtility.score,
          individualResult: candidateResult,
        });
      }
    } catch (err) {
      console.warn('Skipping dividend reinvestment candidate that failed to simulate', asset.id, err);
    }
  }

  if (beneficial.length === 0) return noOpResult(bestResult, bestUtility);

  const overrides: Record<string, boolean> = {};
  for (const r of beneficial) overrides[r.assetId] = r.flippedValue;

  let combinedResult: SimulationResult;
  let combinedUtility: UtilityBreakdown;
  try {
    const combinedParams = buildParamsWithReinvestmentOverrides(params, plan, overrides);
    combinedResult = engine.runForUtility(combinedParams);
    combinedUtility = computeLifetimeUtility(combinedResult, combinedParams, cfg);
  } catch (err) {
    console.warn('Skipping combined dividend reinvestment verification', err);
    return noOpResult(bestResult, bestUtility);
  }

  if (combinedUtility.score <= bestUtility.score) return noOpResult(bestResult, bestUtility);

  return {
    recommendedAssetReinvestment: overrides,
    perAssetResults: beneficial,
    finalResult: combinedResult,
    finalUtility: combinedUtility,
  };
}

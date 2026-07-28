import {
  CompleteWithdrawalPlan,
  SimulationParams,
  SimulationResult,
  StrategyRecommendation,
  UtilityBreakdown,
  UtilityConfig,
} from '../../entities/types';
import { DomainError } from '../../entities/errors';
import { SimulationEngine } from '../SimulationEngine';
import { computeLifetimeUtility } from '../utility/UtilityEngine';
import { getIdentityPlan } from './StrategyCandidateGenerator';
import { computeDeltas } from './deltas';

export interface DividendReinvestmentPerAssetResult {
  assetId: string;
  assetName: string;
  flippedValue: boolean;
  utilityDelta: number;
  deltas: StrategyRecommendation['deltas'];
}

export interface DividendReinvestmentOptimizationResult {
  recommendedAssetReinvestment: Record<string, boolean> | null;
  perAssetResults: DividendReinvestmentPerAssetResult[];
  // finalResult/finalUtility는 단일 생산자(optimizeDividendReinvestment)가 항상 함께 설정하는
  // 상관 필드다. 개선을 못 찾으면 bestResult/bestUtility가 그대로 채워지므로 호출부는 분기 없이
  // 무조건 소비할 수 있다(no-op이어도 항상 유효한 값이 들어 있음).
  finalResult: SimulationResult;
  finalUtility: UtilityBreakdown;
  // Phase 3 진행 중 DomainError로 건너뛴 평가 횟수(자산별 루프 + 통합 검증 단계 각각 1건씩 집계).
  // "개선을 못 찾음"과 "계산 실패로 건너뜀"을 상위(RecommendationEngine)가 구분할 수 있게 한다.
  failedAssetCount: number;
}

// 자산별 평가에서 유리하다고 판단된 후보. 통합 검증을 건너뛰는 단일-자산 지름길에서 재사용하기
// 위해 이미 계산해 둔 SimulationResult/UtilityBreakdown을 함께 들고 다닌다.
interface BeneficialCandidate {
  perAsset: DividendReinvestmentPerAssetResult;
  result: SimulationResult;
  utility: UtilityBreakdown;
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

function noOpResult(
  bestResult: SimulationResult,
  bestUtility: UtilityBreakdown,
  failedAssetCount: number
): DividendReinvestmentOptimizationResult {
  return {
    recommendedAssetReinvestment: null,
    perAssetResults: [],
    finalResult: bestResult,
    finalUtility: bestUtility,
    failedAssetCount,
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
  if (params.assets.length === 0) return noOpResult(bestResult, bestUtility, 0);

  const plan = bestPlan ?? getIdentityPlan(params);
  const beneficial: BeneficialCandidate[] = [];
  let failedAssetCount = 0;

  for (const asset of params.assets) {
    const flippedValue = !asset.reinvestDividend;
    try {
      const candidateParams = buildParamsWithReinvestmentOverrides(params, plan, { [asset.id]: flippedValue });
      const candidateResult = engine.runForUtility(candidateParams);
      const candidateUtility = computeLifetimeUtility(candidateResult, candidateParams, cfg);
      if (candidateUtility.score > bestUtility.score) {
        beneficial.push({
          perAsset: {
            assetId: asset.id,
            assetName: asset.name,
            flippedValue,
            utilityDelta: candidateUtility.score - bestUtility.score,
            deltas: computeDeltas(bestResult, candidateResult),
          },
          result: candidateResult,
          utility: candidateUtility,
        });
      }
    } catch (err) {
      // DomainError(예상된 도메인 거부)는 이 후보만 건너뛰고 계속 진행한다. 그 외 예외는 실제
      // 버그이므로 삼키지 않고 재던진다(recommendStrategy 호출부가 recommendationFailed로 처리).
      if (err instanceof DomainError) {
        failedAssetCount++;
        console.warn('Skipping dividend reinvestment candidate that failed to simulate', asset.id, err);
      } else {
        throw err;
      }
    }
  }

  if (beneficial.length === 0) return noOpResult(bestResult, bestUtility, failedAssetCount);

  const overrides: Record<string, boolean> = {};
  for (const b of beneficial) overrides[b.perAsset.assetId] = b.perAsset.flippedValue;

  let combinedResult: SimulationResult;
  let combinedUtility: UtilityBreakdown;
  if (beneficial.length === 1) {
    // 유리한 자산이 하나뿐이면 통합 검증은 자산별 루프에서 이미 돌린 단일 override와 정확히 동일한
    // 시뮬레이션이라 재실행이 낭비다. 그 결과를 그대로 재사용한다(runForUtility 총 1회만 호출).
    combinedResult = beneficial[0].result;
    combinedUtility = beneficial[0].utility;
  } else {
    try {
      const combinedParams = buildParamsWithReinvestmentOverrides(params, plan, overrides);
      combinedResult = engine.runForUtility(combinedParams);
      combinedUtility = computeLifetimeUtility(combinedResult, combinedParams, cfg);
    } catch (err) {
      if (err instanceof DomainError) {
        failedAssetCount++;
        console.warn(
          'Skipping combined dividend reinvestment verification',
          { overrides, beneficialCount: beneficial.length },
          err
        );
        return noOpResult(bestResult, bestUtility, failedAssetCount);
      }
      throw err;
    }
  }

  if (combinedUtility.score <= bestUtility.score) return noOpResult(bestResult, bestUtility, failedAssetCount);

  return {
    recommendedAssetReinvestment: overrides,
    perAssetResults: beneficial.map((b) => b.perAsset),
    finalResult: combinedResult,
    finalUtility: combinedUtility,
    failedAssetCount,
  };
}

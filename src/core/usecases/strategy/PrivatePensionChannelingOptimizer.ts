import {
  ItemizedContribution,
  PrivatePension,
  SimulationParams,
  SimulationResult,
  UtilityBreakdown,
  UtilityConfig,
} from '../../entities/types';
import { DomainError } from '../../entities/errors';
import { SimulationEngine } from '../SimulationEngine';
import { computeLifetimeUtility } from '../utility/UtilityEngine';
import { PRIVATE_PENSION_MIN_START_AGE } from '../pension/privatePensionRules';
import { computeDeltas } from './deltas';

const NEW_PENSION_MONTHLY_CONTRIBUTION = 750000; // 연 900만원 세액공제 한도
const NEW_PENSION_ID = 'phase4-new-private-pension';

export interface PrivatePensionChannelingResult {
  recommendedPrivatePensionChanneling: boolean | null;
  itemizedContribution: ItemizedContribution | null;
  finalResult: SimulationResult;
  finalUtility: UtilityBreakdown;
  failed: boolean;
}

function noOp(bestResult: SimulationResult, bestUtility: UtilityBreakdown, failed = false): PrivatePensionChannelingResult {
  return {
    recommendedPrivatePensionChanneling: null,
    itemizedContribution: null,
    finalResult: bestResult,
    finalUtility: bestUtility,
    failed,
  };
}

function buildNewPension(templatePension: PrivatePension): PrivatePension {
  return {
    id: NEW_PENSION_ID,
    type: 'irp',
    investmentType: templatePension.investmentType,
    annualReturn: templatePension.annualReturn,
    dividendYield: templatePension.dividendYield,
    balance: 0,
    monthlyContribution: NEW_PENSION_MONTHLY_CONTRIBUTION,
    currency: templatePension.currency,
  };
}

// Phase 1~3 최적 결과(bestResult/bestUtility) 대비, 사적연금을 55세부터 조기 수령해 ISA로
// 재투자하고 신규 연금 계좌를 하나 더 열어 retirementAge까지 납입하는 전략을 켔을 때 더 유리한지
// 단 1회 재시뮬레이션으로 판단한다. 계좌별 조합 탐색은 하지 않는다 — 기존 사적연금 계좌 전부를
// 한꺼번에 채널링 대상으로 켜는 단일 통합 on/off 전략이다.
export function optimizePrivatePensionChanneling(
  params: SimulationParams,
  bestResult: SimulationResult,
  bestUtility: UtilityBreakdown,
  engine: SimulationEngine,
  cfg: UtilityConfig
): PrivatePensionChannelingResult {
  const hasPension = params.privatePensions.length > 0;
  const hasIsa = (params.isaAccounts?.length ?? 0) > 0;
  const hasBridgeWindow = params.userProfile.retirementAge > PRIVATE_PENSION_MIN_START_AGE;

  if (!hasPension || !hasIsa || !hasBridgeWindow) return noOp(bestResult, bestUtility);

  const candidateParams: SimulationParams = {
    ...params,
    privatePensions: [
      ...params.privatePensions.map((p) => ({ ...p, earlyChannelingEnabled: true })),
      buildNewPension(params.privatePensions[0]),
    ],
  };

  try {
    const candidateResult = engine.runForUtility(candidateParams);
    const candidateUtility = computeLifetimeUtility(candidateResult, candidateParams, cfg);

    if (candidateUtility.score <= bestUtility.score) return noOp(bestResult, bestUtility);

    return {
      recommendedPrivatePensionChanneling: true,
      itemizedContribution: {
        label: '사적연금을 55세부터 조기 수령해 ISA에 재투자하고, 신규 연금 계좌를 개설해 퇴직 전까지 납입합니다.',
        utilityDelta: candidateUtility.score - bestUtility.score,
        deltas: computeDeltas(bestResult, candidateResult),
      },
      finalResult: candidateResult,
      finalUtility: candidateUtility,
      failed: false,
    };
  } catch (err) {
    if (err instanceof DomainError) {
      console.warn('Skipping private pension channeling candidate that failed to simulate', err);
      return noOp(bestResult, bestUtility, true);
    }
    throw err;
  }
}

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
    // Fix(critical): ISA 만기 시 기존 동작(isaMaturityDestination 미지정 시 'pension')대로 두면
    // 브릿지 인출로 채널링해 넣은 자금이 만기마다 activePensions[0](바로 그 채널링 대상 계좌인
    // 경우가 흔함)로 되돌아가, 같은 돈에 반복 과세만 되고 성장 이득은 없는 "트레드밀" 손실이
    // 발생한다(200M 원금 기준 채널링 단독 효과가 순손실 -7.16M로 측정됨). 이 전략이 켜지면
    // ISA 만기 자금은 항상 일반 자산으로 보내 이 손실을 제거한다. params.withdrawalPlan의 다른
    // 필드(nationalPensionStartAge 등)는 그대로 보존하기 위해 객체 전체가 아니라 이 필드만 덮어쓴다.
    // 알려진 잔여 엣지 케이스: 사용자의 activeAssets가 0개면 SimulationEngine의 4단계 폴백에 의해
    // 여전히 activePensions[0]로 되돌아갈 수 있다 — 이 경우는 손실이 시뮬레이션에 그대로 반영되므로
    // (숨겨지지 않으므로) 별도 처리하지 않고 남겨둔다.
    withdrawalPlan: { ...params.withdrawalPlan, isaMaturityDestination: 'asset' },
    privatePensions: [
      // Fix(important): 채널링 대상 계좌는 조기 인출과 동시에 납입을 계속할 수 없다(한국 세법상
      // 연금 개시 후 해당 계좌 재납입 불가이며, 애초에 신규 계좌로 납입을 옮기는 것이 전략의
      // 전제이기도 하다) — monthlyContribution을 0으로 강제한다.
      ...params.privatePensions.map((p) => ({ ...p, earlyChannelingEnabled: true, monthlyContribution: 0 })),
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

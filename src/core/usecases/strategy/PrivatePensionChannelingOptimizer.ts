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

// Phase 4는 서로 다른 두 개의 독립 후보(레그)를 평가한다.
//   (A) 채널링: 기존 사적연금을 55세부터 저율과세 한도 내에서 조기 수령해 ISA로 재투자한다.
//   (B) 신규계좌 납입: 연금 계좌를 새로 열어 퇴직 전까지 월 75만원을 추가 납입한다.
//
// 주의: 이 시뮬레이터는 은퇴 전 근로소득과 소득세를 모델링하지 않는다. 따라서 신규 연금 계좌
// 납입의 실제 이점인 "세액공제"는 Utility 점수에 전혀 반영되지 않으며, 이 레그의 개선분은
// 오직 "추가로 저축한 자금"의 효과다(추가 저축이므로 대체로 개선으로 나온다). 반면 채널링
// 레그는 기존 자산의 재배치라 순유입이 보존되며, 세율·수익률 차이에 따른 진짜 최적화다.
//
// 두 레그를 하나로 묶어 평가하면 (B)의 순유입이 (A)의 손실을 가려, 채널링 단독으로는 오히려
// 손해인 사용자에게도 "채널링 채택 +N점"으로 표시되는 문제가 있었다(측정: baseline 60 →
// 채널링만 63 → 신규계좌만 68 → 묶음 72). 그래서 각 레그를 같은 baseline 대비 독립 평가한다.

const NEW_PENSION_MONTHLY_CONTRIBUTION = 750000; // 연 900만원 세액공제 한도 — 원화(KRW) 법정 한도다
const NEW_PENSION_ID = 'phase4-new-private-pension';
const CHANNELING_TRANSFER_PENSION_ID = 'phase4-channeling-transfer-pension';

const CHANNELING_LABEL =
  '사적연금을 55세부터 저율과세 한도(연 1,500만원) 내에서 조기 수령해 ISA에 재투자합니다. ' +
  '기존 연금 계좌 납입은 중단하고 같은 금액을 새 계좌로 옮기며, ISA 만기 자금은 일반 자산으로 이전합니다.';
const NEW_PENSION_LABEL =
  '연금 계좌를 새로 개설해 퇴직 전까지 월 75만원(연 900만원 세액공제 한도)을 추가로 납입합니다.';

export interface PrivatePensionChannelingResult {
  // 채널링 레그 채택 여부. 채택되면 true, 아니면 null(false는 생산하지 않는다).
  recommendedPrivatePensionChanneling: true | null;
  // 신규 연금계좌 납입 레그 채택 여부. 채택되면 true, 아니면 null.
  recommendedNewPensionContribution: true | null;
  // 채택된 레그별 항목(0~2개). 순서: 채널링 → 신규계좌.
  itemizedContributions: ItemizedContribution[];
  // finalResult/finalUtility는 Phase 3와 동일한 규약이다: 개선을 못 찾으면 입력받은
  // bestResult/bestUtility가 그대로 채워지므로 호출부는 분기 없이 무조건 소비할 수 있다.
  finalResult: SimulationResult;
  finalUtility: UtilityBreakdown;
  // 실제로 engine.runForUtility를 호출한 횟수(전제조건 미충족이면 0).
  attemptedCount: number;
  // 그중 DomainError로 실패한 횟수.
  failedCount: number;
}

type Leg = 'channeling' | 'new-pension' | 'combined';

interface LegEvaluation {
  result: SimulationResult;
  utility: UtilityBreakdown;
}

// SimulationEngine.getExchangeRate가 private이라 여기서 동일한 계산을 복제한다. 엔진 쪽이 바뀌면
// 이 함수도 함께 고쳐야 한다(환산 결과가 어긋나면 순유입 보존이 깨진다).
function resolveExchangeRate(params: SimulationParams): number {
  const base = params.baseExchangeRate;
  if (params.exchangeScenario === 'usd_up') return base * 1.1;
  if (params.exchangeScenario === 'usd_down') return base * 0.9;
  return base;
}

// 신규/이전용 연금 계좌 생성 공통 헬퍼. 운용 조건(수익률/투자종류/배당률)만 템플릿 계좌에서
// 복사하고 잔액은 0으로 시작한다. 통화는 항상 KRW로 고정한다 — 이 계좌들이 다루는 금액은
// 원화 법정 한도(월 75만원) 또는 이미 KRW로 환산한 납입 합계라, 템플릿 계좌의 통화(USD 등)를
// 그대로 복사하면 금액이 그 통화로 재해석되어 유령 자산이 생긴다.
function buildPensionAccount(
  templatePension: PrivatePension,
  id: string,
  monthlyContributionKRW: number
): PrivatePension {
  return {
    id,
    type: 'irp',
    investmentType: templatePension.investmentType,
    annualReturn: templatePension.annualReturn,
    dividendYield: templatePension.dividendYield,
    balance: 0,
    monthlyContribution: monthlyContributionKRW,
    currency: 'KRW',
  };
}

// 채널링 레그 후보. 기존 계좌를 전부 조기수령 대상으로 켜고, 그 계좌들의 납입은 중단한다
// (한국 세법상 연금 개시 후 해당 계좌 재납입 불가). 중단한 납입 합계는 이전용 계좌로 옮겨
// baseline과 순유입(총 월 납입액)을 동일하게 유지한다 — 그래야 "채널링 자체"의 효과만 측정된다.
function buildChannelingParams(params: SimulationParams): SimulationParams {
  const exchangeRate = resolveExchangeRate(params);
  const transferredContributionKRW = params.privatePensions.reduce(
    (sum, p) => sum + (p.currency === 'USD' ? p.monthlyContribution * exchangeRate : p.monthlyContribution),
    0
  );

  const channeledPensions: PrivatePension[] = params.privatePensions.map((p) => ({
    ...p,
    earlyChannelingEnabled: true,
    monthlyContribution: 0,
  }));
  if (transferredContributionKRW > 0) {
    channeledPensions.push(
      buildPensionAccount(params.privatePensions[0], CHANNELING_TRANSFER_PENSION_ID, transferredContributionKRW)
    );
  }

  return {
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
    privatePensions: channeledPensions,
  };
}

// 신규계좌 레그 후보. 채널링은 켜지 않고 월 75만원 납입 계좌만 추가한다. 인출계획(withdrawalPlan)은
// 이 레그와 무관하므로 건드리지 않는다.
function buildNewPensionParams(params: SimulationParams): SimulationParams {
  return {
    ...params,
    privatePensions: [
      ...params.privatePensions,
      buildPensionAccount(params.privatePensions[0], NEW_PENSION_ID, NEW_PENSION_MONTHLY_CONTRIBUTION),
    ],
  };
}

function noOp(
  bestResult: SimulationResult,
  bestUtility: UtilityBreakdown,
  attemptedCount: number,
  failedCount: number
): PrivatePensionChannelingResult {
  return {
    recommendedPrivatePensionChanneling: null,
    recommendedNewPensionContribution: null,
    itemizedContributions: [],
    finalResult: bestResult,
    finalUtility: bestUtility,
    attemptedCount,
    failedCount,
  };
}

// Phase 1~3 최적 결과(bestResult/bestUtility)를 공통 baseline으로 삼아, 채널링 레그와 신규계좌
// 레그를 각각 독립적으로 평가한다. 계좌별 조합 탐색은 하지 않는다 — 각 레그는 기존 사적연금 계좌
// 전부를 한꺼번에 대상으로 하는 단일 on/off 전략이다.
export function optimizePrivatePensionChanneling(
  params: SimulationParams,
  bestResult: SimulationResult,
  bestUtility: UtilityBreakdown,
  engine: SimulationEngine,
  cfg: UtilityConfig
): PrivatePensionChannelingResult {
  // 공통 전제: 신규/이전용 계좌의 운용 조건을 복사할 템플릿 계좌가 필요하고, 채널링 대상도 있어야 한다.
  const hasPension = params.privatePensions.length > 0;
  const hasIsa = (params.isaAccounts?.length ?? 0) > 0;
  const hasBridgeWindow = params.userProfile.retirementAge > PRIVATE_PENSION_MIN_START_AGE;
  // 두 레그 모두 은퇴 전 기간이 있어야 의미가 있다(채널링은 브릿지 인출, 신규계좌는 납입 기간).
  const hasPreRetirementWindow = params.userProfile.currentAge < params.userProfile.retirementAge;

  const evaluateChanneling = hasPension && hasIsa && hasBridgeWindow && hasPreRetirementWindow;
  const evaluateNewPension = hasPension && hasPreRetirementWindow;

  let attemptedCount = 0;
  let failedCount = 0;

  // try는 runForUtility 호출만 감싼다 — computeLifetimeUtility/computeDeltas의 실패까지 삼키면
  // 코드 버그가 "시뮬레이션 실패"로 오분류된다.
  const runLeg = (leg: Leg, candidateParams: SimulationParams): LegEvaluation | null => {
    attemptedCount++;
    let result: SimulationResult;
    try {
      result = engine.runForUtility(candidateParams);
    } catch (err) {
      // DomainError(예상된 도메인 거부)는 이 레그만 건너뛰고 계속 진행한다. 그 외 예외는 실제
      // 버그이므로 삼키지 않고 재던진다(recommendStrategy 호출부가 recommendationFailed로 처리).
      if (err instanceof DomainError) {
        failedCount++;
        console.warn(
          'Skipping private pension channeling candidate that failed to simulate',
          {
            leg,
            pensionCount: params.privatePensions.length,
            isaCount: params.isaAccounts?.length ?? 0,
            currentAge: params.userProfile.currentAge,
            retirementAge: params.userProfile.retirementAge,
          },
          err
        );
        return null;
      }
      throw err;
    }
    return { result, utility: computeLifetimeUtility(result, candidateParams, cfg) };
  };

  const channelingEval = evaluateChanneling ? runLeg('channeling', buildChannelingParams(params)) : null;
  const newPensionEval = evaluateNewPension ? runLeg('new-pension', buildNewPensionParams(params)) : null;

  const channelingBeneficial = channelingEval !== null && channelingEval.utility.score > bestUtility.score;
  const newPensionBeneficial = newPensionEval !== null && newPensionEval.utility.score > bestUtility.score;

  if (!channelingBeneficial && !newPensionBeneficial) return noOp(bestResult, bestUtility, attemptedCount, failedCount);

  const makeItem = (label: string, evaluation: LegEvaluation): ItemizedContribution => ({
    label,
    // 각 항목은 "그 레그 하나만 baseline에 적용했을 때"의 독립(marginal) 효과다. 두 레그를 함께
    // 채택해도 이 값은 각자의 단독 측정치를 유지하므로 합계가 총 개선분과 정확히 일치하지는 않는다.
    utilityDelta: evaluation.utility.score - bestUtility.score,
    deltas: computeDeltas(bestResult, evaluation.result),
  });

  const adoptChannelingOnly = (evaluation: LegEvaluation): PrivatePensionChannelingResult => ({
    recommendedPrivatePensionChanneling: true,
    recommendedNewPensionContribution: null,
    itemizedContributions: [makeItem(CHANNELING_LABEL, evaluation)],
    finalResult: evaluation.result,
    finalUtility: evaluation.utility,
    attemptedCount,
    failedCount,
  });

  const adoptNewPensionOnly = (evaluation: LegEvaluation): PrivatePensionChannelingResult => ({
    recommendedPrivatePensionChanneling: null,
    recommendedNewPensionContribution: true,
    itemizedContributions: [makeItem(NEW_PENSION_LABEL, evaluation)],
    finalResult: evaluation.result,
    finalUtility: evaluation.utility,
    attemptedCount,
    failedCount,
  });

  if (!newPensionBeneficial) return adoptChannelingOnly(channelingEval!);
  if (!channelingBeneficial) return adoptNewPensionOnly(newPensionEval!);

  // 둘 다 유리하면 함께 적용한 params로 한 번 더 평가한다(레그 간 상호작용 반영). 통합 결과가
  // baseline보다 나쁘거나 계산에 실패하면 더 나은 단일 레그만 채택한다 — Phase 3의 통합 검증과
  // 같은 안전장치다.
  const combinedEval = runLeg('combined', buildNewPensionParams(buildChannelingParams(params)));
  if (combinedEval === null || combinedEval.utility.score <= bestUtility.score) {
    return channelingEval!.utility.score >= newPensionEval!.utility.score
      ? adoptChannelingOnly(channelingEval!)
      : adoptNewPensionOnly(newPensionEval!);
  }

  return {
    recommendedPrivatePensionChanneling: true,
    recommendedNewPensionContribution: true,
    itemizedContributions: [
      makeItem(CHANNELING_LABEL, channelingEval!),
      makeItem(NEW_PENSION_LABEL, newPensionEval!),
    ],
    finalResult: combinedEval.result,
    finalUtility: combinedEval.utility,
    attemptedCount,
    failedCount,
  };
}

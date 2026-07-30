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
// 합성 계좌 id는 테스트와 진단이 후보 params에서 이 계좌들을 금액이 아니라 id로 식별할 수 있도록
// export한다(납입 합계가 우연히 750,000원이면 금액 기반 식별은 두 계좌를 혼동한다).
export const NEW_PENSION_ID = 'phase4-new-private-pension';
// 이전용 계좌는 원본 계좌마다 하나씩 생기므로 id는 단일 상수가 아니라 접두사 + 원본 id다.
// (원본별로 나누는 이유는 buildChannelingParams 주석 참조 — 운용 조건 보존)
export const CHANNELING_TRANSFER_PENSION_ID_PREFIX = 'phase4-channeling-transfer-pension';
export function isChannelingTransferPensionId(id: string): boolean {
  return id.startsWith(`${CHANNELING_TRANSFER_PENSION_ID_PREFIX}-`);
}

// 두 번째 문장(계좌 이전/ISA 만기 이전)은 이 레그의 점수가 어떤 가정 위에 서 있는지 알리는 것이다
// (모듈 헤더의 모델 한계 참조). 이 라벨은 체크리스트·PDF·AI 프롬프트로 그대로 흘러가므로, 여기
// 적으면 모든 표면에 전달된다.
//
// "기존 계좌 납입 중단 후 새 계좌로 이전" 절은 hasAccountTransfer(= 채널링 대상 계좌 중
// monthlyContribution > 0인 계좌가 하나라도 있는지)일 때만 넣는다 — 전부 납입 0인 사용자는
// buildChannelingParams가 이전용 계좌를 아예 만들지 않으므로(코드 참조), 시뮬레이션되지 않은
// 행동을 단언하면 안 된다. ISA 만기 이전 문장은 채널링이 켜지면 항상 참이므로(withdrawalPlan
// 오버라이드가 무조건 적용됨) 조건 없이 남긴다.
function buildChannelingLabel(hasAccountTransfer: boolean): string {
  return (
    '사적연금을 55세부터 조기 수령해 ISA에 재투자합니다. 실제로 옮길 수 있는 금액은 사적연금 ' +
    '저율과세 한도(연 1,500만원)와 ISA 납입 한도(연 2,000만원)의 잔여 여력 중 더 작은 쪽으로 ' +
    '제한되며, ISA에 이미 정기 납입을 하고 있다면 대개 ISA 잔여 납입 한도가 실질적인 상한이 되어 ' +
    '연 1,500만원보다 훨씬 적은 금액만 이전됩니다. ' +
    (hasAccountTransfer ? '기존 연금 계좌 납입은 중단하고 같은 금액·같은 운용 조건의 새 계좌로 옮기며, ' : '') +
    'ISA 만기 자금은 일반 자산으로 이전합니다.'
  );
}
const NEW_PENSION_LABEL =
  '연금 계좌를 새로 개설해 퇴직 전까지 월 75만원(연 900만원 세액공제 한도)을 추가로 납입합니다. ' +
  '이 점수는 현재 계획 밖에서 추가로 마련한 자금을 납입한다고 가정한 결과이며, ' +
  '실제 이점인 세액공제 효과는 포함하지 않았습니다(시뮬레이터가 은퇴 전 근로소득·소득세를 다루지 않기 때문입니다).';

export interface PrivatePensionChannelingResult {
  // 채널링 레그 채택 여부. 채택되면 true, 아니면 null(false는 생산하지 않는다).
  recommendedPrivatePensionChanneling: true | null;
  // 신규 연금계좌 납입 레그 채택 여부. 채택되면 true, 아니면 null.
  recommendedNewPensionContribution: true | null;
  // 채널링 채택 시 "기존 연금 계좌 납입 중단 후 새 계좌로 이전" 행동이 실제로 포함되는지.
  // recommendedPrivatePensionChanneling이 true일 때만 의미가 있고, 그 외에는 false다.
  channelingIncludesAccountTransfer: boolean;
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

type Leg = 'channeling' | 'channeling-baseline' | 'new-pension' | 'combined';

interface LegEvaluation {
  result: SimulationResult;
  utility: UtilityBreakdown;
}

// 신규 연금 계좌(4-B 레그) 생성 헬퍼. 운용 조건(수익률/투자종류/배당률)만 템플릿 계좌에서
// 복사하고 잔액은 0으로 시작한다. 통화는 항상 KRW로 고정한다 — 납입액이 원화 법정 한도
// (월 75만원)라, 템플릿 계좌의 통화(USD 등)를 그대로 복사하면 금액이 그 통화로 재해석되어
// 유령 자산이 생긴다.
function buildNewPensionAccount(templatePension: PrivatePension): PrivatePension {
  return {
    id: NEW_PENSION_ID,
    type: 'irp',
    investmentType: templatePension.investmentType,
    annualReturn: templatePension.annualReturn,
    dividendYield: templatePension.dividendYield,
    balance: 0,
    monthlyContribution: NEW_PENSION_MONTHLY_CONTRIBUTION,
    currency: 'KRW',
  };
}

// 이전용 계좌 생성 헬퍼. 원본 계좌 하나당 하나씩 만들고, 납입액뿐 아니라 운용 조건
// (annualReturn/investmentType/dividendYield)과 통화까지 원본 그대로 복제한다. 잔액만 0에서
// 시작하고, 이 계좌 자체는 채널링 대상이 아니다(넣자마자 다시 빼면 순유입 보존이 무의미해진다).
function buildTransferPensionAccount(source: PrivatePension): PrivatePension {
  return {
    ...source,
    id: `${CHANNELING_TRANSFER_PENSION_ID_PREFIX}-${source.id}`,
    balance: 0,
    earlyChannelingEnabled: false,
  };
}

// 채널링 레그 후보. 기존 계좌를 전부 조기수령 대상으로 켜고, 그 계좌들의 납입은 중단한다
// (한국 세법상 연금 개시 후 해당 계좌 재납입 불가). 중단한 납입은 이전용 계좌로 옮겨 baseline과
// 순유입(총 월 납입액)을 동일하게 유지한다 — 그래야 "채널링 자체"의 효과만 측정된다.
//
// 이전용 계좌는 반드시 **원본 계좌마다 하나씩** 만든다. 예전처럼 납입 합계를 하나의 계좌로 묶으면
// 그 계좌의 운용 조건을 privatePensions[0]에서 복사하게 되어, 금액은 보존되지만 성장 프로필이
// 바뀐다. 퇴직연금(2%, 예금) + 연금저축(8%, ETF)처럼 수익률이 섞인 흔한 구성에서 8%로 굴러야 할
// 납입이 2%로 굴러 은퇴까지 수천만~1억원대의 종말가치 차이를 만들고(배열 순서를 뒤집으면 부호가
// 반대로 뒤집힌다), 이는 측정하려는 채널링 효과(수백만원대)보다 훨씬 커서 채택/기각 판정을
// 좌우한다 — C3(대조군 없는 비교)와 같은 계열의 결함이다.
function buildChannelingParams(params: SimulationParams): SimulationParams {
  const channeledPensions: PrivatePension[] = params.privatePensions.map((p) => ({
    ...p,
    earlyChannelingEnabled: true,
    monthlyContribution: 0,
  }));
  // 통화 환산이 전혀 필요 없다 — 각 이전용 계좌가 원본의 통화를 그대로 쓰므로 엔진의
  // getExchangeRate를 복제할 이유도 사라진다.
  for (const p of params.privatePensions) {
    if (p.monthlyContribution > 0) channeledPensions.push(buildTransferPensionAccount(p));
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
    privatePensions: [...params.privatePensions, buildNewPensionAccount(params.privatePensions[0])],
  };
}

// 채널링 레그의 대조군(control). buildChannelingParams와 동일하게 isaMaturityDestination만
// 'asset'으로 바꾸고, 조기수령 관련 필드(earlyChannelingEnabled/monthlyContribution)는 전혀
// 건드리지 않는다. ISA 만기 목적지 변경 자체가 채널링과 무관하게 이미 유리한 사용자(예: ISA
// 정기납입이 월 한도를 채워 브릿지 인출이 실질적으로 0원인 경우)에게, 그 효과가 채널링 효과로
// 오귀속되는 것을 막기 위한 기준선이다 — channelingBeneficial은 bestUtility가 아니라 이 대조군
// 대비로 판정해야 "채널링을 켠 것 자체"의 순수 효과만 측정된다.
function buildIsaAssetOnlyParams(params: SimulationParams): SimulationParams {
  return {
    ...params,
    withdrawalPlan: { ...params.withdrawalPlan, isaMaturityDestination: 'asset' },
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
    channelingIncludesAccountTransfer: false,
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

  // 채널링 후보는 항상 isaMaturityDestination을 'asset'으로 바꿔서 평가되므로(buildChannelingParams),
  // bestUtility(원래 withdrawalPlan 기준)와 직접 비교하면 그 필드 변경 효과까지 채널링 효과로
  // 잡힌다. 같은 오버라이드를 적용하되 조기수령은 켜지 않은 대조군을 별도로 평가해, 채널링의
  // 순수 marginal 효과만 채택 판정에 쓴다.
  const channelingBaselineEval = evaluateChanneling
    ? runLeg('channeling-baseline', buildIsaAssetOnlyParams(params))
    : null;
  const channelingEval = evaluateChanneling ? runLeg('channeling', buildChannelingParams(params)) : null;
  const newPensionEval = evaluateNewPension ? runLeg('new-pension', buildNewPensionParams(params)) : null;

  const channelingBeneficial =
    channelingEval !== null &&
    channelingBaselineEval !== null &&
    channelingEval.utility.score > channelingBaselineEval.utility.score;
  const newPensionBeneficial = newPensionEval !== null && newPensionEval.utility.score > bestUtility.score;

  if (!channelingBeneficial && !newPensionBeneficial) return noOp(bestResult, bestUtility, attemptedCount, failedCount);

  // 채널링 대상 계좌 중 납입 중인 계좌가 하나라도 있어야 이전용 계좌가 생기고, 그래야 라벨의
  // "계좌 이전" 문구가 실제로 시뮬레이션된 행동이 된다(buildChannelingParams 참조).
  const hasAccountTransfer = params.privatePensions.some((p) => p.monthlyContribution > 0);

  const makeItem = (label: string, evaluation: LegEvaluation): ItemizedContribution => ({
    label,
    // 각 항목은 "그 레그 하나만 baseline에 적용했을 때"의 독립(marginal) 효과다. 두 레그를 함께
    // 채택해도 이 값은 각자의 단독 측정치를 유지하므로 합계가 총 개선분과 정확히 일치하지는 않는다.
    // (채널링 항목은 채택 판정과 달리 여기서는 bestUtility 대비 총 delta를 그대로 보여준다 —
    // isaMaturityDestination 변경도 채널링 채택 시 실제로 적용되는 행동이므로 표시상 숨기지 않는다.)
    utilityDelta: evaluation.utility.score - bestUtility.score,
    deltas: computeDeltas(bestResult, evaluation.result),
  });

  const adoptChannelingOnly = (evaluation: LegEvaluation): PrivatePensionChannelingResult => ({
    recommendedPrivatePensionChanneling: true,
    recommendedNewPensionContribution: null,
    channelingIncludesAccountTransfer: hasAccountTransfer,
    itemizedContributions: [makeItem(buildChannelingLabel(hasAccountTransfer), evaluation)],
    finalResult: evaluation.result,
    finalUtility: evaluation.utility,
    attemptedCount,
    failedCount,
  });

  const adoptNewPensionOnly = (evaluation: LegEvaluation): PrivatePensionChannelingResult => ({
    recommendedPrivatePensionChanneling: null,
    recommendedNewPensionContribution: true,
    channelingIncludesAccountTransfer: false,
    itemizedContributions: [makeItem(NEW_PENSION_LABEL, evaluation)],
    finalResult: evaluation.result,
    finalUtility: evaluation.utility,
    attemptedCount,
    failedCount,
  });

  if (!newPensionBeneficial) return adoptChannelingOnly(channelingEval!);
  if (!channelingBeneficial) return adoptNewPensionOnly(newPensionEval!);

  // 둘 다 유리하면 함께 적용한 params로 한 번 더 평가한다(레그 간 상호작용 반영).
  const combinedEval = runLeg('combined', buildNewPensionParams(buildChannelingParams(params)));

  // 이제 검증된 후보가 셋(채널링 단독 / 신규계좌 단독 / 통합)이므로 그중 최고점을 채택한다.
  // "통합이 baseline보다 나으면 통합"이 아니다 — 레그 간 상호작용이 sub-additive면 통합(85)이
  // baseline(70)보다는 나아도 이미 손에 든 단일 레그(90)보다 나쁠 수 있다. 세 결과가 모두
  // 계산 완료 상태라 최선을 고르는 데 추가 시뮬레이션 비용이 들지 않는다.
  // 통합이 실패(DomainError)했거나 단일 레그보다 나쁘면 자연스럽게 단일 레그로 폴백된다 —
  // Phase 3의 통합 검증과 같은 안전장치다.
  //
  // 동점 처리는 두 가지가 있고 근거가 서로 다르다:
  //  (1) 통합 == 단일 레그: 더 적은 행동을 요구하는 단일 레그를 고른다(통합 채택은 두 레그를 모두
  //      실행하라는 뜻이므로 추가 행동에 대한 대가가 0이면 권할 이유가 없다).
  //  (2) 채널링 == 신규계좌(아래 `>=`): 채널링을 고른다. 이건 "행동이 더 적어서"가 아니다 —
  //      오히려 채널링이 요구하는 행동이 더 많다(납입 중단 + 새 계좌 개설 + 조기수령 개시 +
  //      ISA 만기 목적지 변경). 근거는 두 점수의 신뢰도 차이다: 신규계좌 레그의 개선분은 모듈
  //      헤더에 적은 대로 "계획 밖의 새 돈을 월 75만원 더 저축한다"는 가정에서 나오는 것이라
  //      진짜 최적화가 아니고 사용자에게 신규 자금 부담을 지운다. 반면 채널링은 순유입이 보존된
  //      기존 자산의 재배치라 점수가 그대로 실현 가능한 이득이다. 동점이면 새 돈을 요구하지 않는
  //      쪽을 권하는 것이 맞다.
  const bestSingleIsChanneling = channelingEval!.utility.score >= newPensionEval!.utility.score;
  const bestSingleScore = Math.max(channelingEval!.utility.score, newPensionEval!.utility.score);
  if (combinedEval === null || combinedEval.utility.score <= bestSingleScore) {
    return bestSingleIsChanneling ? adoptChannelingOnly(channelingEval!) : adoptNewPensionOnly(newPensionEval!);
  }

  return {
    recommendedPrivatePensionChanneling: true,
    recommendedNewPensionContribution: true,
    channelingIncludesAccountTransfer: hasAccountTransfer,
    itemizedContributions: [
      makeItem(buildChannelingLabel(hasAccountTransfer), channelingEval!),
      makeItem(NEW_PENSION_LABEL, newPensionEval!),
    ],
    finalResult: combinedEval.result,
    finalUtility: combinedEval.utility,
    attemptedCount,
    failedCount,
  };
}

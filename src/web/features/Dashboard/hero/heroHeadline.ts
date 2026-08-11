import { getRetirementGradeColorTier } from '../../../../core/entities/retirementGrade';
import {
  PLAN_CONFIDENCE_BAND_LABEL,
  PLAN_CONFIDENCE_BAND_TIER,
  PlanConfidence,
  PlanConfidenceBandKey,
} from '../../../../core/usecases/dashboard/computePlanConfidence';
import { PlanOutcome } from '../../../../core/usecases/dashboard/resolvePlanOutcome';

export interface HeroHeadline {
  emoji: '🟢' | '🟡' | '🔴';
  text: string;
}

const TIER_EMOJI = { green: '🟢', orange: '🟡', red: '🔴' } as const;

// 두 확률이 이만큼 벌어지면 그 차이 자체가 사용자에게 정보다 — 아래 buildDivergenceClause 참조.
const RATE_DIVERGENCE_THRESHOLD = 0.2;

export interface HeroHeadlineInput {
  expectancy: number;
  // 결정론 결과에서 유도한 세 사건. 확률이 없어도 문장이 성립해야 한다.
  outcome: PlanOutcome;
  // 밴드·두 확률·색을 여기 한 곳에서 받는다. 예전에는 utilityScore로 등급을, monteCarlo로
  // 충돌을 따로 유도해 한 문장 안에서 세 축이 섞였다.
  confidence: PlanConfidence;
}

// AI Summary Hero 최상단의 한 줄 요약. 새 LLM 호출을 추가하지 않고, 이미 계산된 확률 밴드와
// 결정론 사건만으로 규칙 기반 문구를 만든다.
//
// **예전 구현이 틀렸던 두 지점.**
//
// 1. 등급을 `getRetirementGrade(utilityScore)`로 뽑았다. 그 임계표(90/80/70/60)는 *은퇴
//    준비도* 점수를 위해 만들어진 것인데 *평생 효용* 점수를 거기에 넣고 있었다. 서로 다른
//    분포의 두 0~100 척도라, 효용 66점이 준비도 66점과 같은 등급을 받을 이유가 없다.
//    시그니처에서 utilityScore를 없앤 것이 이 재발을 구조적으로 막는다.
// 2. 결정론이 "고갈 없음"인데 MC 성공률이 낮으면 `'기준 시나리오는 안정적이나 시장 변동성
//    대응이 필요합니다.'`라는 고정 문구를 앞에 붙였다. 그래서 성공률 39%인 계획의 첫 단어가
//    "안정적"이 됐다. 리뷰에서 지적된 최우선 모순이 이것이다.
//
// 이제 판정은 **확률 밴드 하나**에서만 나오고(computePlanConfidence), 결정론 절은 사실을
// 서술하기만 한다.
export function buildHeroHeadline({ expectancy, outcome, confidence }: HeroHeadlineInput): HeroHeadline {
  const events = describeEvents(outcome, expectancy);

  // MC를 못 받은 상태(워커 미지원/계산 전/추천안 미리보기)에서는 확률을 지어내지 않는다.
  // 대신 그 사실을 밝힌다 — 밝히지 않으면 결정론 결과가 확률 판정처럼 읽힌다.
  // 이 분기에서만 점수로 색을 정하는데, 그 점수는 **은퇴 준비도** 점수라 임계표와 축이 맞는다.
  if (confidence.basis !== 'probabilistic' || confidence.band === undefined || confidence.rates === undefined) {
    return {
      emoji: TIER_EMOJI[getRetirementGradeColorTier(confidence.deterministicScore)],
      text: `${events} 아래 판정은 기준 시나리오 기준입니다(시장 변동성 미반영).`,
    };
  }

  const { band, rates } = confidence;
  const spendingPercent = Math.round(rates.spendingSuccessRate * 100);
  const assetPercent = Math.round(rates.assetSuccessRate * 100);

  return {
    emoji: TIER_EMOJI[PLAN_CONFIDENCE_BAND_TIER[band]],
    text:
      `${events} ${BAND_VERDICT[band]} ` +
      `시장 변동을 반영하면 계획한 생활비를 한 해도 줄이지 않을 확률은 ${spendingPercent}%, ` +
      `${expectancy}세까지 자산이 남을 확률은 ${assetPercent}%입니다(${PLAN_CONFIDENCE_BAND_LABEL[band]}).` +
      buildDivergenceClause(rates.spendingSuccessRate, rates.assetSuccessRate),
  };
}

// 확률 세계의 판정. 밴드 하나에서만 나온다 — 같은 조건을 여러 곳에 적어 두면 임계를 바꿀 때
// 한 곳만 고쳐지고 KPI 배지(CoreKpiGrid)와 갈라진다.
const BAND_VERDICT: Record<PlanConfidenceBandKey, string> = {
  very_stable: '시장이 흔들려도 계획이 유지될 가능성이 매우 높습니다.',
  stable: '시장 변동을 반영해도 계획이 대체로 유지됩니다.',
  moderate: '대체로 유지되지만 여유가 크지는 않습니다.',
  caution: '시장 변동에 따라 계획이 흔들릴 수 있습니다.',
  risky: '시장이 나빠지면 계획이 무너질 가능성이 높습니다.',
  very_risky: '현재 계획으로는 노후 생활비를 감당하기 어렵습니다.',
};

// 기준 수익률 세계에서 무슨 일이 일어났는지. **판정하지 않고 사실만 말한다** — 판정은 밴드가
// 전담한다.
//
// **총자산 고갈은 헤드라인에 등장시키지 않는다.** 현금 잔고는 음수가 될 수 없으므로
// `총자산 고갈 ⟹ 투자자산 소진`이고, 따라서 투자자산 절이 그 사실을 이미 담고 있다. 나머지
// 흥미로운 부분("그 뒤 연금 잉여로 다시 늘어난다")은 한 줄 요약이 감당할 정보가 아니라
// 차트 캡션의 몫이다.
function describeEvents(outcome: PlanOutcome, expectancy: number): string {
  const { assetStatus, investableDepletionAge, spendingShortfall } = outcome;

  const shortfallClause = spendingShortfall
    ? `${spendingShortfall.firstAge}세부터 ${spendingShortfall.years}년간 계획한 생활비에 못 미칩니다.`
    : null;

  if (assetStatus === 'no_investable_asset') {
    return shortfallClause
      ? `등록된 투자자산이 없어 연금 등 고정소득만으로 생활하는 계획이며, ${shortfallClause}`
      : '등록된 투자자산이 없지만, 연금 등 고정소득이 계획한 생활비를 채웁니다.';
  }

  if (investableDepletionAge !== null) {
    return shortfallClause
      ? `${investableDepletionAge}세에 투자자산이 모두 소진되고, ${shortfallClause}`
      : `${investableDepletionAge}세에 투자자산이 모두 소진되지만, 이후에는 연금 소득이 계획한 생활비를 채웁니다.`;
  }

  // 총자산은 고갈되는데 투자자산 소진 나이를 못 잡은 경우(은퇴 이전 고갈 — findInvestableDepletionAge가
  // 은퇴 나이 이후만 훑는다)를 위한 방어선. 정상 경로에서는 위 분기가 먼저 걸린다.
  if (assetStatus === 'depleted') {
    return shortfallClause
      ? `기대수명 전에 자산이 모두 소진되고, ${shortfallClause}`
      : '기대수명 전에 자산이 모두 소진되지만, 이후에는 연금 소득이 계획한 생활비를 채웁니다.';
  }

  return shortfallClause
    ? `${expectancy}세까지 투자자산은 남지만, ${shortfallClause}`
    : `${expectancy}세까지 투자자산이 고갈되지 않고, 계획한 생활비도 매년 온전히 유지됩니다.`;
}

// 두 확률이 크게 갈리면 그 방향 자체가 계획의 성격을 말한다. 밝히지 않으면 사용자는 두 숫자
// 중 무엇을 믿어야 할지 모른 채 낮은 쪽만 본다.
function buildDivergenceClause(spendingRate: number, assetRate: number): string {
  if (spendingRate - assetRate >= RATE_DIVERGENCE_THRESHOLD) {
    return ' 자산이 바닥나도 연금 소득이 생활비를 메우는 경로가 그만큼 있다는 뜻입니다.';
  }
  if (assetRate - spendingRate >= RATE_DIVERGENCE_THRESHOLD) {
    return ' 자산은 남아도 계획한 생활비를 다 쓰지 못하는 경로가 그만큼 있다는 뜻입니다.';
  }
  return '';
}

import { SimulationParams, UtilityAxis, UtilityConfig, UtilityRaws } from '../../entities/types';
import { OBJECTIVE_WEIGHT_PRESETS } from './objectivePresets';
import { scoreUtilityRaws } from '../utility/UtilityEngine';
import { applyEconomicScenario, GoverningEconomicScenario } from '../scenario/economicScenarios';
import { applyYieldPreset } from '../scenario/applyYieldPreset';
import { resolveStrategy } from './compileStrategy';

// **가정 축의 'ai_*'는 "값을 채워 달라"가 아니라 "이 차원이 미정임을 인정하라"는 뜻이다.**
//
// 리스크 성향과 경제 시나리오는 사용자의 *가정*이다. 미정이라고 해서 AI가 임의의 값을
// 골라 채우면, 화면은 「AI 추천」을 보여주는데 곡선은 누군가 몰래 고른 특정 국면 하나로
// 그려진다 — 사용자가 한 번도 동의한 적 없는 미래다.
//
// 대신 상위 후보들을 여러 국면에서 다시 평가해 **최악이 가장 나은** 계획을 고른다.
// 사용자가 입력한 물가·수익률은 절대 덮어쓰지 않고, 화면에 그려지는 곡선도 사용자 가정
// 그대로다. 바뀌는 것은 "어느 인출 계획을 추천하는가"뿐이다.

export interface AssumptionVariant {
  label: string;
  apply(params: SimulationParams): SimulationParams;
}

const ECONOMIC_VARIANT_KEYS: readonly GoverningEconomicScenario[] = [
  'long_term_average', 'recession', 'high_inflation', 'low_growth',
];

const YIELD_VARIANT_KEYS = ['conservative', 'base', 'aggressive'] as const;

// 미정으로 남은 가정 축에 대응하는 국면 목록. 비어 있으면 강건성 모드가 꺼진 것이다.
//
// 두 축이 모두 미정이어도 **곱집합을 쓰지 않는다**(4 × 3 = 12). 합집합으로도 "어느 방향의
// 충격에도 견디는가"를 묻기에 충분하고, 곱집합은 상위 후보 수만큼 곱해져 비용이 빠르게 는다.
export function resolveAssumptionVariants(params: SimulationParams): readonly AssumptionVariant[] {
  const strategy = resolveStrategy(params);
  const variants: AssumptionVariant[] = [];

  if (strategy.economicScenario === 'ai_recommended') {
    for (const scenario of ECONOMIC_VARIANT_KEYS) {
      variants.push({
        label: `경제:${scenario}`,
        apply: (p) => applyEconomicScenario(p, scenario),
      });
    }
  }

  if (strategy.riskProfile === 'ai_recommended') {
    for (const preset of YIELD_VARIANT_KEYS) {
      variants.push({
        label: `수익률:${preset}`,
        apply: (p) => applyYieldPreset(p, preset),
      });
    }
  }

  return variants;
}

// 국면별 점수 중 **최악**이 가장 좋은 후보를 고른다.
//
// 여기서는 최솟값 비교가 옳다 — 같은 채점 기준(cfg)으로 서로 다른 세계 상태를 평가하므로
// 점수의 수준이 서로 비교 가능하다. (목표 우선순위는 다르다. 아래 후회 최소화 참고.)
//
// 어떤 국면에서도 평가하지 못한 후보(전부 null)는 탈락시킨다 — 계산되지 않은 계획을
// "최악이 좋다"고 말할 수는 없다.
export function pickMostRobust<T>(
  candidates: readonly T[],
  variants: readonly AssumptionVariant[],
  scoreUnder: (candidate: T, variant: AssumptionVariant) => number | null
): T | null {
  if (candidates.length === 0 || variants.length === 0) return null;

  let best: T | null = null;
  let bestWorst = -Infinity;

  for (const candidate of candidates) {
    const scores = variants
      .map((variant) => scoreUnder(candidate, variant))
      .filter((score): score is number => score !== null);
    if (scores.length !== variants.length) continue;

    const worst = Math.min(...scores);
    if (worst > bestWorst) {
      bestWorst = worst;
      best = candidate;
    }
  }

  return best;
}

const OBJECTIVE_KEYS = Object.keys(OBJECTIVE_WEIGHT_PRESETS) as Array<keyof typeof OBJECTIVE_WEIGHT_PRESETS>;

// 목표별 점수를 한 번에 계산한다. 원점수(raws)는 목표와 무관하므로 재시뮬레이션이 0회다
// (UtilityEngine.computeUtilityRaws 참고).
function scoresByObjective(raws: UtilityRaws): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const objective of OBJECTIVE_KEYS) {
    scores[objective] = scoreUtilityRaws(raws, OBJECTIVE_WEIGHT_PRESETS[objective]).score;
  }
  return scores;
}

// 목표 우선순위가 미정일 때의 선택 기준: **정규화된 최대 후회의 최소화.**
//
// 후보 i의 목표 j에 대한 후회 = (그 목표의 최고점 − i의 점수) / 그 목표의 최고점.
// 이 중 가장 큰 값이 i의 최대 후회이고, 그것이 가장 작은 후보를 고른다.
// "어느 목표를 골랐더라도 크게 후회하지 않을 계획"이라는 뜻이다.
//
// **목표별 최솟값(min-over-objectives)을 쓰면 안 된다.** 목표마다 도달 가능한 점수의
// 수준 자체가 다르기 때문이다. 예를 들어 상속 최대화는 bequestAdequacy에 35점을 걸지만
// 그 원점수는 현실 시나리오에서 흔히 0에 가깝다(적정선의 10배쯤 남기면 종형 곡선이
// 포화한다) — 그러면 **모든** 후보가 그 목표에서만 낮은 점수를 받는다.
//
// 최솟값 비교는 그런 "구조적으로 낮은 목표"가 순위를 지배하게 만든다. 후보가 어쩌지 못하는
// 축 하나가 사실상 유일한 기준이 되는 것이다. 정규화는 각 목표를 그 목표의 최고점 대비
// 상대 손실로 바꿔 이 수준 차이를 제거한다.
// (robustness.test.ts가 두 기준이 서로 다른 답을 내는 반례를 고정한다.)
export function maxNormalizedRegret(
  raws: UtilityRaws,
  allRaws: readonly UtilityRaws[]
): number {
  const own = scoresByObjective(raws);
  const all = allRaws.map(scoresByObjective);

  let worst = 0;
  for (const objective of OBJECTIVE_KEYS) {
    const best = Math.max(...all.map((s) => s[objective]), own[objective]);
    // 최고점이 0이면 그 목표에서는 모든 후보가 똑같이 0점이라 후회를 정의할 수 없다.
    if (best <= 0) continue;
    worst = Math.max(worst, (best - own[objective]) / best);
  }
  return worst;
}

// 최대 후회가 가장 작은 후보. 동점이면 앞선 후보(= 원래 점수 순서가 높은 쪽)를 유지한다.
export function pickLowestRegret<T extends { raws: UtilityRaws }>(candidates: readonly T[]): T | null {
  if (candidates.length === 0) return null;

  const allRaws = candidates.map((c) => c.raws);
  let best = candidates[0];
  let bestRegret = maxNormalizedRegret(best.raws, allRaws);

  for (const candidate of candidates.slice(1)) {
    const regret = maxNormalizedRegret(candidate.raws, allRaws);
    if (regret < bestRegret) {
      bestRegret = regret;
      best = candidate;
    }
  }

  return best;
}

// cfg의 가중치가 어느 목표 프리셋과도 다르면(사용자 정의 가중치) 후회 최소화의 전제가
// 흔들린다. 목표 프리셋 표 위에서만 의미가 있는 계산이므로 호출부가 이 판정을 쓴다.
export function isObjectivePresetConfig(cfg: UtilityConfig): boolean {
  const axes = Object.keys(cfg.weights) as UtilityAxis[];
  return OBJECTIVE_KEYS.some((objective) => {
    const preset = OBJECTIVE_WEIGHT_PRESETS[objective];
    return axes.every((axis) => preset[axis] === cfg.weights[axis]);
  });
}

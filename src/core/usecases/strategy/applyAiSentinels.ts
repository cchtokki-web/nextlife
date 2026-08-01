import { StrategyRecommendation } from '../../entities/types';
import { CompiledStrategy, resolveStrategy } from './compileStrategy';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../pension/nationalPensionRules';

// 'ai_*' 센티널이 남아 있는 축을 AI 추천값으로 채운다.
//
// compileStrategy는 센티널을 baseline으로 내린다("아직 미정, 기본값으로 두되 AI 제안을
// 받겠다"). 이 함수가 그 후반부를 담당한다 — 추천이 도착하면 미정 축만 추천값으로 바꿔
// 시뮬레이션에 넘긴다.
//
// compileStrategy 안에 넣지 않고 별도 단계로 둔 이유는 시그니처 순환이다: compileStrategy가
// 추천을 반영하려면 추천이 필요한데, recommendStrategy는 이미 컴파일된 params를 입력으로
// 요구한다 — 서로의 출력을 서로의 입력으로 요구하는 순환이라 한 함수로 합칠 수 없다.
//
// 사용자 params는 건드리지 않는다. 반환값은 engine.run과 화면 표시로만 흘러가며,
// 추천 계산의 입력은 언제나 센티널 미적용 원본(compiled)이다 — 그래서 "적용 → 재계산 →
// 재적용" 되먹임이 구조적으로 불가능하다.
export function applyAiSentinels(
  compiled: CompiledStrategy,
  recommendation: StrategyRecommendation | undefined
): CompiledStrategy {
  // improved가 false이면 recommendedPlan은 "baseline 유지 권장"이라 채울 것이 없다.
  if (!recommendation?.improved) return compiled;

  const recommendedPlan = recommendation.recommendedPlan;
  if (!recommendedPlan) return compiled;

  const strategy = resolveStrategy(compiled.params);
  if (strategy.nationalPensionStrategy !== 'ai_optimized') return compiled;

  const recommendedAge = recommendedPlan.nationalPensionStartAge;
  // withdrawalPlan이 없는 것(compileStrategy의 통과 경로 등)은 엔진 기본값 65세와
  // 같은 의미이므로, 폴백 없이 undefined로 비교하면 65세 추천에서도 불필요하게
  // 새 객체를 만들게 된다.
  const currentAge = compiled.params.withdrawalPlan?.nationalPensionStartAge
    ?? NATIONAL_PENSION_NORMAL_START_AGE;
  // 값이 같으면 새 객체를 만들지 않는다. 참조가 바뀌면 page.tsx의 하위 useMemo가 전부
  // 무효화되어 이 화면에서 가장 무거운 렌더(engine.run)가 매번 다시 돈다.
  if (recommendedAge === currentAge) return compiled;

  return {
    ...compiled,
    params: {
      ...compiled.params,
      withdrawalPlan: {
        ...(compiled.params.withdrawalPlan ?? {}),
        nationalPensionStartAge: recommendedAge,
      },
    },
  };
}

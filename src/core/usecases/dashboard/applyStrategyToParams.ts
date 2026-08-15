import type { SimulationParams } from '../../entities/types';
import type { RankedStrategyCandidate } from '../../strategy/StrategyOptimizer';
import { STRATEGY_FIELD_MAP, type StrategyFieldKey } from './strategyFieldMap';

// 추천 전략을 사용자의 시나리오 설정에 반영한다.
//
// 축의 정의는 strategyFieldMap이 소유한다 — describeStrategyChanges(카드·PDF의 「달라지는
// 점」)와 **같은 테이블**을 본다. 이 함수는 그중 «반영»만 꺼내 순서대로 접는다.
//
// React에 의존하지 않는다. 어느 params에 적용할지 고르는 일은 호출자(page.tsx)의 몫이며,
// 여기서는 넘겨받은 params만 다룬다.

export interface StrategyFieldOutcome {
  key: StrategyFieldKey;
  label: string;
}

export interface StrategyFieldSkip extends StrategyFieldOutcome {
  reason: string;
}

export interface StrategyApplicationResult {
  /** 반영된 새 params. 바뀐 축이 하나도 없으면 **입력과 같은 참조**를 돌려준다. */
  params: SimulationParams;
  /** 실제로 값이 바뀐 축. */
  applied: readonly StrategyFieldOutcome[];
  /**
   * 현재 계획과 다르지만 반영하지 못한 축. 호출자는 이것을 반드시 사용자에게 알린다 —
   * 밝히지 않으면 "전략 전체를 적용했다"는 화면의 약속과 실제가 조용히 어긋난다.
   */
  skipped: readonly StrategyFieldSkip[];
}

export function applyStrategyToParams(
  params: SimulationParams,
  ranked: RankedStrategyCandidate,
): StrategyApplicationResult {
  const applied: StrategyFieldOutcome[] = [];
  const skipped: StrategyFieldSkip[] = [];
  let next = params;

  for (const field of STRATEGY_FIELD_MAP) {
    // 판정은 «원본» params 기준이다. 접힌 중간값을 보면 앞 축이 바꾼 값 때문에 뒤 축의
    // 판정이 달라질 수 있고, 그러면 카드가 보여준 목록과 실제 적용 목록이 어긋난다.
    if (!field.differs(params, ranked)) continue;

    const outcome = field.apply(next, ranked);
    if (outcome.applied) {
      next = outcome.params;
      applied.push({ key: field.key, label: field.label });
    } else {
      skipped.push({ key: field.key, label: field.label, reason: outcome.reason });
    }
  }

  return { params: next, applied, skipped };
}

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
//
// ## 「현재 계획」이 둘이라는 문제
//
// 이 함수가 값을 써 넣는 곳(사용자가 입력한 activeParams)과 카드가 「현재 계획」이라 부르며
// 변경점을 서술한 기준(센티널 자동 채움까지 끝난 analysis.effective.params)은 같지 않다.
// applyAiSentinels가 「미정」인 축을 추천값으로 채우기 때문이다 — 국민연금 개시 나이를 정한
// 적 없는 계획에서 센티널이 66세를 채우면, 카드는 66세를 현재값으로 말하는데 사용자 설정에는
// 그 값이 없다(=기본 65세).
//
// 그래서 반영 대상은 «두 기준의 합집합»이다. 한쪽만 보면 실제로 이런 결함이 났다.
//
//  - 사용자 설정만 보던 때: 후보가 65세를 원하고 사용자 설정도 미지정(=65세)이면 「반영할
//    것 없음」으로 판정해 버튼이 잠겼다. 카드는 「국민연금 66세 → 65세」라는 변경점을 또렷이
//    보여 주고 있었고, 사용자에게는 그 계획을 만들 방법이 없었다. 실제로는 센티널이 66세로
//    올리지 못하도록 65세를 «확정»해야 하는 상황이다.
//  - 서술 기준만 보게 하면: 후보와 서술 기준이 같은 축(위 예의 66세)을 반영에서 빼게 되는데,
//    그러면 다른 축을 반영하며 strategy 객체가 실체화될 때 withStrategy가 사용자 설정의
//    65세로 그 축을 고정해 버려, 카드가 시뮬레이션한 66세 계획이 65세 계획으로 바뀐다.
//
// 두 기준이 같으면(호출자가 simulated를 생략하면) 합집합은 그 하나와 같으므로 동작이 바뀌지
// 않는다. 서술은 여전히 서술 기준 하나만 본다 — 카드는 «계획»이 어떻게 달라지는지 말하는
// 것이고, 계획은 엔진에 실제로 들어간 쪽이다.

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

/** 「적용」을 누르기 전에 화면이 알아야 하는 것. previewStrategyApply가 한 번에 낸다. */
export interface StrategyApplyPreview {
  /** 버튼을 열어도 되는가. */
  canApply: boolean;
  /**
   * 반영되지만 카드가 「달라지는 점」에 «적지 않은» 축.
   *
   * 센티널이 이미 채워 둔 값이라 계획은 달라지지 않지만, 사용자 설정에는 그 값이 확정된다.
   * 반영을 빼면 계획이 재현되지 않으므로(파일 머리말) 없앨 수 없는 부작용이고, 그래서
   * 화면은 이것을 누르기 «전»에 예고해야 한다. 밝히지 않으면 「달라지는 점」 목록이
   * "이것만 바뀐다"는 약속으로 읽힌다.
   */
  pinned: readonly StrategyFieldOutcome[];
}

/**
 * 「적용」을 누르면 무슨 일이 일어나는지 미리 셈한다. 버튼 활성화와 예고 문구가 **한 번의
 * 계산**에서 나와야, 둘이 서로 다른 판정을 말하는 일이 생기지 않는다.
 *
 * **params를 «둘» 받는 것이 이 함수의 존재 이유다.**
 *  - `target` — 실제로 값을 써 넣을 사용자 설정(page.tsx의 activeParams)
 *  - `simulated` — 카드가 「달라지는 점」을 서술한 기준이자 엔진에 실제로 들어간 값
 *    (analysis.effective.params)
 *
 * 둘이 왜 어긋나는지는 파일 머리말의 「현재 계획이 둘이라는 문제」에 있다. target만 보고
 * 판정하던 예전 코드에서는 «카드가 변경점을 하나도 보여 주지 않는 후보»의 버튼이 켜졌고,
 * 누르면 화면이 말한 적 없는 국민연금 축이 설정에 확정됐다.
 *
 * canApply는 «축 단위 교집합»이다 — 반영되는 축 중에 카드가 실제로 말한 것이 하나라도
 * 있는가. 집합의 크기만 비교하면(변경점이 하나라도 있고 반영할 것도 하나라도 있으면 참)
 * 카드는 A를 말하고 적용은 B만 하는 조합이 그대로 통과한다 — 목표를 고르지 않아 은퇴
 * 시점이 반영 불가인 계획에서 실제로 나오는 조합이다.
 *
 * pinned는 그 «여집합»이다. 두 목록이 같은 applied에서 갈라져 나오므로, 카드가 말한 축과
 * 예고할 축을 합치면 언제나 실제로 반영되는 축 전체가 된다.
 */
export function previewStrategyApply(
  target: SimulationParams,
  simulated: SimulationParams,
  ranked: RankedStrategyCandidate,
): StrategyApplyPreview {
  const appliedKeys = new Set(
    applyStrategyToParams(target, ranked, simulated).applied.map((field) => field.key)
  );
  const applied = STRATEGY_FIELD_MAP.filter((field) => appliedKeys.has(field.key));

  return {
    canApply: applied.some((field) => field.differs(simulated, ranked)),
    pinned: applied
      .filter((field) => !field.differs(simulated, ranked))
      .map((field) => ({ key: field.key, label: field.label })),
  };
}

export function applyStrategyToParams(
  /** 값을 써 넣을 사용자 설정. */
  params: SimulationParams,
  ranked: RankedStrategyCandidate,
  /**
   * 카드가 「달라지는 점」을 서술한 기준. 생략하면 `params`와 같다고 본다.
   * 왜 따로 받는지는 파일 머리말의 「현재 계획이 둘이라는 문제」 참고.
   */
  simulated: SimulationParams = params,
): StrategyApplicationResult {
  const applied: StrategyFieldOutcome[] = [];
  const skipped: StrategyFieldSkip[] = [];
  let next = params;

  for (const field of STRATEGY_FIELD_MAP) {
    // 판정은 «원본» params 기준이다. 접힌 중간값을 보면 앞 축이 바꾼 값 때문에 뒤 축의
    // 판정이 달라질 수 있고, 그러면 카드가 보여준 목록과 실제 적용 목록이 어긋난다.
    if (!field.differs(params, ranked) && !field.differs(simulated, ranked)) continue;

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

import type { SimulationParams } from '../../entities/types';
import type { RankedStrategyCandidate } from '../../strategy/StrategyOptimizer';
import { STRATEGY_FIELD_MAP } from './strategyFieldMap';

// 「현재 계획에서 달라지는 점」. 화면의 추천 카드와 PDF 리포트가 **같은 함수**를 쓴다.
//
// 예전에는 이 로직이 StrategyRecommendationCards.tsx 안에만 있었고 PDF에는 추천이 아예
// 없었다. PDF에 추천을 실으면서 문구를 다시 짜면 같은 계획의 두 문서가 서로 다른 변경
// 목록을 말하게 된다 — 그래서 계산이 아니라 «서술»이지만 Single Source of Truth를 지킨다.
//
// 축의 정의(무엇이 다른가·어떻게 적는가·어떻게 반영하는가)는 strategyFieldMap이 소유한다.
// 이 함수는 그중 «서술»만 꺼내 쓴다 — 추천을 설정에 반영하는 applyStrategyToParams가
// 같은 테이블의 «반영»을 꺼내 쓰므로, 둘이 서로 다른 축 목록을 보는 일이 생길 수 없다.

export interface StrategyChange {
  label: string;
  before: string;
  after: string;
}

export function describeStrategyChanges(
  params: SimulationParams,
  ranked: RankedStrategyCandidate,
  formatValue: (value: number) => string,
): StrategyChange[] {
  return STRATEGY_FIELD_MAP
    .filter((field) => field.differs(params, ranked))
    .map((field) => ({ label: field.label, ...field.describe(params, ranked, formatValue) }));
}

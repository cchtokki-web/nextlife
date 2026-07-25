import { getIdentityPlan } from '../strategy/StrategyCandidateGenerator';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../pension/nationalPensionRules';
import { SimulationParams, StrategyRecommendation } from '../../entities/types';

export interface RoadmapEventItem {
  title: string;
  description: string;
}

export interface RoadmapEvent {
  age: number;
  items: RoadmapEventItem[];
}

export interface ExecutionRoadmap {
  events: RoadmapEvent[];
  expectancy: number;
}

// 국민연금 수령 개시 나이를 정상 개시 나이(65)와 비교해 조기/연기 여부를 제목에 표기한다.
function describeNationalPensionTitle(age: number): string {
  if (age < NATIONAL_PENSION_NORMAL_START_AGE) return '국민연금 수령 개시 (조기)';
  if (age > NATIONAL_PENSION_NORMAL_START_AGE) return '국민연금 수령 개시 (연기)';
  return '국민연금 수령 개시';
}

// AI 추천 계획(또는 추천이 없거나 개선안이 없을 때는 getIdentityPlan로 현재 설정값) 기준으로 퇴직/
// 일반자산 인출/사적연금/국민연금 수령 개시 나이 4개 이벤트를 계산한다. 같은 나이에 여러 이벤트가
// 겹치면 하나의 노드로 병합하고, 나이 오름차순으로 정렬해 반환한다.
export function computeExecutionRoadmap(
  params: SimulationParams,
  recommendation: StrategyRecommendation | undefined
): ExecutionRoadmap {
  const plan = recommendation?.recommendedPlan ?? getIdentityPlan(params);
  const { retirementAge, expectancy } = params.userProfile;

  const rawEvents: { age: number; item: RoadmapEventItem }[] = [
    {
      age: retirementAge,
      item: { title: '퇴직', description: '상용소득이 종료되고 자산 인출 계획이 시작됩니다.' },
    },
    {
      age: plan.generalAssetWithdrawalStartAge,
      item: { title: '일반자산 인출 개시', description: '주식/ETF 등 일반 자산의 인출을 시작합니다.' },
    },
    {
      age: plan.privatePensionStartAge,
      item: { title: '사적연금 수령 개시', description: '사적연금(퇴직연금·연금저축 등) 인출을 시작합니다.' },
    },
    {
      age: plan.nationalPensionStartAge,
      item: { title: describeNationalPensionTitle(plan.nationalPensionStartAge), description: '국민연금 수령을 시작합니다.' },
    },
  ];

  const byAge = new Map<number, RoadmapEventItem[]>();
  for (const { age, item } of rawEvents) {
    const items = byAge.get(age) ?? [];
    items.push(item);
    byAge.set(age, items);
  }

  const events: RoadmapEvent[] = Array.from(byAge.entries())
    .map(([age, items]) => ({ age, items }))
    .sort((a, b) => a.age - b.age);

  return { events, expectancy };
}

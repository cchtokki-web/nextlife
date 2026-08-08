import { getIdentityPlan } from '../strategy/StrategyCandidateGenerator';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../pension/nationalPensionRules';
import { clampPrivatePensionStartAge, PRIVATE_PENSION_MIN_START_AGE } from '../pension/privatePensionRules';
import { SimulationParams, SimulationResult, StrategyRecommendation } from '../../entities/types';
import { PlanAssetStatus } from './resolvePlanAssetStatus';

// 로드맵(computeExecutionRoadmap)에 넘길 depletionAge를 고르는 단일 지점. 화면(DashboardSection)과
// PDF(simulator/page.tsx) 양쪽에서 이 함수로 호출부를 통일해, 로드맵의 나이 마일스톤과 자산 고갈
// 나이가 항상 같은 시나리오를 가리키도록 보장한다.
//
// recommendation이 개선(improved)을 찾았으면 로드맵의 마일스톤도 추천 시나리오
// (recommendation.recommendedPlan ?? getIdentityPlan) 기준으로 그려지므로, 고갈 나이도 같은
// recommendedResult에서 가져와야 한다. recommendedPlan 유무만으로 판단하면 Phase 3/4(배당
// 재투자, 사적연금 채널링, 신규 연금계좌 납입)가 단독으로 채택되어 recommendedPlan은 null이지만
// improved는 true인 경우, 로드맵은 추천 시나리오의 마일스톤과 baseline 시나리오의 고갈 나이를
// 섞어 보여주는 모순이 생긴다. improved가 아니면(개선을 찾지 못했거나 recommendation이 없으면)
// baseline인 result의 고갈 나이를 쓴다.
export function selectDepletionAge(
  recommendation: StrategyRecommendation | undefined,
  result: SimulationResult
): number | null {
  return recommendation?.improved ? recommendation.recommendedResult.depletionAge : result.depletionAge;
}

export interface RoadmapEventItem {
  title: string;
  description: string;
  // 위험 신호(예: 자산 고갈)를 다른 이벤트와 시각적으로 구분해 강조하기 위한 선택적 플래그.
  severity?: 'warning';
  // 이 마일스톤이 AI 추천으로 현재 설정에서 옮겨진 것이면, 옮겨지기 전 나이.
  //
  // 추천에는 최적화 축이 아닌 항목도 함께 그려지므로, 표시가 없으면 한 타임라인 안에
  // "추천 기준"과 "현재 설정 기준"이 섞인 것으로 읽힌다.
  changedFromAge?: number;
}

export interface RoadmapEvent {
  age: number;
  items: RoadmapEventItem[];
}

export interface ExecutionRoadmap {
  events: RoadmapEvent[];
  // 타임라인의 종점(본인 나이 기준) = 본인 기대수명.
  endAge: number;
  endLabel: string;
}

// 국민연금 수령 개시 나이를 정상 개시 나이(65)와 비교해 조기/연기 여부를 제목에 표기한다.
function describeNationalPensionTitle(age: number): string {
  if (age < NATIONAL_PENSION_NORMAL_START_AGE) return '국민연금 수령 개시 (조기)';
  if (age > NATIONAL_PENSION_NORMAL_START_AGE) return '국민연금 수령 개시 (연기)';
  return '국민연금 수령 개시';
}

// AI 추천 계획(또는 추천이 없거나 개선안이 없을 때는 getIdentityPlan로 현재 설정값) 기준으로 퇴직/
// 일반자산 인출/사적연금/국민연금 수령 개시 나이와, 있다면 자산 고갈 예상 나이까지 이벤트를
// 계산한다. 같은 나이에 여러 이벤트가 겹치면 하나의 노드로 병합하고, 나이 오름차순으로 정렬해
// 반환한다.
export function computeExecutionRoadmap(
  params: SimulationParams,
  recommendation: StrategyRecommendation | undefined,
  depletionAge: number | null,
  status: PlanAssetStatus
): ExecutionRoadmap {
  const identityPlan = getIdentityPlan(params);
  const plan = recommendation?.recommendedPlan ?? identityPlan;
  const { retirementAge, expectancy } = params.userProfile;

  // 추천이 이 나이를 옮겼으면 옮기기 전 나이를 함께 싣는다. 호출부가 추천을 넘기지 않는
  // (= 현재 설정 기준) 모드에서는 plan === identityPlan이라 항상 undefined다.
  const changedFrom = (recommendedAge: number, currentAge: number): number | undefined =>
    recommendedAge === currentAge ? undefined : currentAge;

  const rawEvents: { age: number; item: RoadmapEventItem }[] = [
    {
      age: retirementAge,
      item: { title: '퇴직', description: '상용소득이 종료되고 자산 인출 계획이 시작됩니다.' },
    },
  ];

  // 인출할 대상이 실제로 있는 이벤트만 그린다. 예전에는 자산·사적연금을 하나도 등록하지 않은
  // 사용자의 로드맵에도 "일반자산 인출 개시"·"사적연금 수령 개시"가 마일스톤으로 찍혀,
  // 존재하지 않는 계좌에서 인출을 시작한다고 말했다.
  if ((params.assets?.length ?? 0) > 0) {
    rawEvents.push({
      age: plan.generalAssetWithdrawalStartAge,
      item: {
        title: '일반자산 인출 개시',
        description: '주식/ETF 등 일반 자산의 인출을 시작합니다.',
        changedFromAge: changedFrom(plan.generalAssetWithdrawalStartAge, identityPlan.generalAssetWithdrawalStartAge),
      },
    });
  }

  if ((params.privatePensions?.length ?? 0) > 0) {
    rawEvents.push({
      // 사적연금 개시 나이는 원칙적으로 법정 최저 나이(55세)로 하한된 retirementAge다 —
      // SimulationEngine.ts의 planStartAge 계산과 동일한 식이어야 한다. 다만 Phase 4(사적연금
      // 조기수령 채널링)가 채택된 경우에는 실제로 55세부터(재직 중) 조기 수령이 시작되므로,
      // 로드맵도 그 실제 시점을 가리켜야 한다 — 그렇지 않으면 채택된 추천안과 로드맵이 서로
      // 다른 나이를 보여주는 모순이 생긴다.
      //
      // 주의: 채널링이 채택돼도 엔진의 정상 인출(생활비 재원)은 사라지지 않는다 — 브릿지는
      // 은퇴 전 조기 인출분을 ISA로 재투자하는 것일 뿐이고, planStartAge(= clampPrivatePensionStartAge
      // (retirementAge)) 기준의 정상 인출은 retirementAge부터 그대로 시작된다. 즉 이 이벤트는
      // 논리적으로 "55세(조기 개시)"와 "retirementAge(정상 개시)" 두 시점을 모두 가지지만,
      // 로드맵은 UI를 단순화하기 위해 더 이른 시점(55세)만 마일스톤으로 표시한다.
      age: recommendation?.recommendedPrivatePensionChanneling
        ? PRIVATE_PENSION_MIN_START_AGE
        : clampPrivatePensionStartAge(retirementAge),
      item: recommendation?.recommendedPrivatePensionChanneling
        ? {
            title: '사적연금 수령 개시 (조기·ISA 재투자)',
            // 채널링 레그가 실제로 시뮬레이션한 내용만 기술한다. 신규 연금 계좌 납입은 이제
            // 독립 후보(recommendedNewPensionContribution)라 채택되지 않을 수 있으므로, 여기에
            // 섞어 쓰면 시뮬레이션하지 않은 행동을 사용자에게 단언하게 된다. "계좌 이전" 절도
            // channelingIncludesAccountTransfer가 false면(채널링 대상 계좌가 전부 납입 0이라
            // 이전용 계좌가 생기지 않은 경우) 뺀다 — 같은 이유다.
            description:
              '사적연금을 55세부터 저율과세 한도 내에서 조기 수령해 ISA에 재투자합니다.' +
              (recommendation?.channelingIncludesAccountTransfer
                ? ' 기존 연금 계좌 납입은 중단하고 같은 금액을 새 계좌로 옮깁니다.'
                : ''),
          }
        : { title: '사적연금 수령 개시', description: '사적연금(퇴직연금·연금저축 등) 인출을 시작합니다.' },
    });
  }

  if ((params.nationalPension?.expectedMonthlyAmount ?? 0) > 0) {
    rawEvents.push({
      age: plan.nationalPensionStartAge,
      item: {
        title: describeNationalPensionTitle(plan.nationalPensionStartAge),
        description: '국민연금 수령을 시작합니다.',
        changedFromAge: changedFrom(plan.nationalPensionStartAge, identityPlan.nationalPensionStartAge),
      },
    });
  }

  // 자산 고갈이 예상되면 다른 마일스톤과 함께 정확히 몇 세에 고갈되는지도 타임라인에
  // 표시한다 — 위험 신호이므로 severity로 구분해 강조한다. 나이 조건 없이 항상 넣는다.
  //
  // 단, 투자자산이 하나도 없는 계획은 제외한다. 엔진이 첫 해에 depletionAge를 잡으므로
  // (자산 0 <= 0) 로드맵 맨 앞에 "51세 자산 고갈 예상" 노드가 찍히는데, 소진될 자산 자체가 없다.
  if (depletionAge !== null && status !== 'no_investable_asset') {
    rawEvents.push({
      age: depletionAge,
      item: {
        title: '자산 고갈 예상',
        description: '누적 자산이 모두 소진되어 목표 생활비를 유지하기 어려워질 것으로 예상됩니다.',
        severity: 'warning',
      },
    });
  }

  const byAge = new Map<number, RoadmapEventItem[]>();
  for (const { age, item } of rawEvents) {
    const items = byAge.get(age) ?? [];
    items.push(item);
    byAge.set(age, items);
  }

  const events: RoadmapEvent[] = Array.from(byAge.entries())
    .map(([age, items]) => ({ age, items }))
    .sort((a, b) => a.age - b.age);

  return {
    events,
    endAge: expectancy,
    endLabel: '기대수명',
  };
}

import { SimulationParams } from '../../entities/types';
import { computeHouseholdEndAge, resolveSpouse } from '../spouse/spouseRules';

// 시뮬레이션이 실제로 도는 연수.
//
// 수익률 경로의 길이가 이 값과 정확히 같아야 한다. 짧으면 뒷부분이 조용히 충격 0이 되어
// 그 구간만 결정론이 되고(엔진은 던지지 않는다), 길면 남는 원소가 버려진다.
//
// runSingle과 같은 계산을 여기서 다시 하는 대신 **같은 spouseRules를 재사용한다** —
// 배우자 규칙이 바뀔 때 두 곳이 조용히 어긋나지 않도록. (runSingle의 totalYears는
// endAge − startAge + 1이고 endAge = computeHouseholdEndAge다.)
export function simulationYearCount(params: SimulationParams): number {
  const spouse = resolveSpouse(params.spouse, params.userProfile);
  const endAge = computeHouseholdEndAge(params.userProfile, spouse);
  return endAge - params.userProfile.currentAge + 1;
}

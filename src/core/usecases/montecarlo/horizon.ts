import { SimulationParams } from '../../entities/types';

// 시뮬레이션이 실제로 도는 연수.
//
// 수익률 경로의 길이가 이 값과 정확히 같아야 한다. 짧으면 뒷부분이 조용히 충격 0이 되어
// 그 구간만 결정론이 되고(엔진은 던지지 않는다), 길면 남는 원소가 버려진다.
// runSingle의 totalYears(endAge − startAge + 1, endAge = 본인 기대수명)와 같은 식이다.
export function simulationYearCount(params: SimulationParams): number {
  return params.userProfile.expectancy - params.userProfile.currentAge + 1;
}

import type { SimulationParams } from '../../entities/types';

/** 기준 연도는 호출자가 제공한다. 출생연도가 없는 기존 계획은 바꾸지 않는다. */
export function refreshAgeFromBirthYear(params: SimulationParams, currentYear: number): SimulationParams {
  const year = params.birthYear;
  if (!Number.isInteger(currentYear) || !Number.isInteger(year)) return params;
  const age = currentYear - year!;
  // 기존 시뮬레이션의 사람 나이 범위를 벗어나면 임의로 보정하지 않는다.
  if (age < 1 || age > 120 || params.userProfile.currentAge === age) return params;
  return { ...params, userProfile: { ...params.userProfile, currentAge: age } };
}

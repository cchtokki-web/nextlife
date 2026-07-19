import { SimulationParams, WithdrawalPlan } from '../../entities/types';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../pension/nationalPensionRules';

const START_AGE_GRID = [60, 62, 65, 67, 70];
const MONTHLY_TARGET_MULTIPLIERS = [0.6, 0.8, 1.0, 1.2, 1.5];
const NATIONAL_PENSION_START_AGE_GRID = [60, 63, 65, 67, 70]; // 조기~연기수령 그리드

// 사적연금 인출 정책 + 국민연금 수령 시점 후보를 유한 grid로 생성한다. 결정론적이고 브라우저에서
// 실시간으로 전부 시뮬레이션 가능한 수준(최대 5×5×5=125개)으로 제한한다.
export function generateCandidatePlans(params: SimulationParams): WithdrawalPlan[] {
  const { userProfile, privatePensions = [], nationalPension } = params;
  if (privatePensions.length === 0) return [];

  const { retirementAge, expectancy, targetMonthlySpending } = userProfile;
  if (targetMonthlySpending <= 0) return [];

  const startAgeCandidates = Array.from(
    new Set([retirementAge, ...START_AGE_GRID].filter((age) => age >= retirementAge && age < expectancy))
  );
  if (startAgeCandidates.length === 0) startAgeCandidates.push(retirementAge);

  const monthlyTargetCandidates = MONTHLY_TARGET_MULTIPLIERS.map((m) => Math.round(targetMonthlySpending * m));

  // 국민연금 수령액이 0이면 시점을 바꿔도 의미가 없으므로 기본값(65세) 단일 후보만 사용해
  // 불필요한 후보 폭증을 막는다.
  const nationalPensionStartAgeCandidates = (nationalPension?.expectedMonthlyAmount ?? 0) > 0
    ? NATIONAL_PENSION_START_AGE_GRID
    : [NATIONAL_PENSION_NORMAL_START_AGE];

  const candidates: WithdrawalPlan[] = [];
  for (const nationalPensionStartAge of nationalPensionStartAgeCandidates) {
    for (const privatePensionStartAge of startAgeCandidates) {
      for (const privatePensionMonthlyTarget of monthlyTargetCandidates) {
        candidates.push({ privatePensionStartAge, privatePensionMonthlyTarget, nationalPensionStartAge });
      }
    }
  }
  return candidates;
}

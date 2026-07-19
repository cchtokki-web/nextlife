import { SimulationParams, WithdrawalPlan } from '../../entities/types';

const START_AGE_GRID = [60, 62, 65, 67, 70];
const MONTHLY_TARGET_MULTIPLIERS = [0.6, 0.8, 1.0, 1.2, 1.5];

// 사적연금 인출 정책 후보를 유한 grid로 생성한다. 결정론적이고 브라우저에서 실시간으로
// 전부 시뮬레이션 가능한 수십 개 수준(최대 5*5=25개)으로 제한한다.
export function generateCandidatePlans(params: SimulationParams): WithdrawalPlan[] {
  const { userProfile, privatePensions = [] } = params;
  if (privatePensions.length === 0) return [];

  const { retirementAge, expectancy, targetMonthlySpending } = userProfile;
  if (targetMonthlySpending <= 0) return [];

  const startAgeCandidates = Array.from(
    new Set([retirementAge, ...START_AGE_GRID].filter((age) => age >= retirementAge && age < expectancy))
  );
  if (startAgeCandidates.length === 0) startAgeCandidates.push(retirementAge);

  const monthlyTargetCandidates = MONTHLY_TARGET_MULTIPLIERS.map((m) => Math.round(targetMonthlySpending * m));

  const candidates: WithdrawalPlan[] = [];
  for (const privatePensionStartAge of startAgeCandidates) {
    for (const privatePensionMonthlyTarget of monthlyTargetCandidates) {
      candidates.push({ privatePensionStartAge, privatePensionMonthlyTarget });
    }
  }
  return candidates;
}

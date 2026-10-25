import type { HealthcareAssumptions } from '../../entities/types';

// 월 30만원은 통계청 가계동향의 60대 이상 보건 지출 수준을 참고한 것이고,
// 증가율 5%는 건강보험 진료비 증가율이 일반 물가를 상회해 온 추세를 반영한다.
//
// 화면(strategyOptions.tsx)에 있던 것을 core로 옮겼다. 저장 데이터 정제
// (normalizeSimulationParams)가 이 값을 필요로 하는데, infrastructure가 web을
// import하면 계층이 뒤집힌다. 화면 쪽은 여기서 재export해 쓴다.
export const DEFAULT_HEALTHCARE: HealthcareAssumptions = {
  enabled: false,
  costGrowthRate: 5,
  baseMonthlyCost: 300000,
  longTermCareEnabled: false,
  longTermCareStartAge: 80,
  longTermCareMonthlyCost: 1500000,
  shockEnabled: false,
  shockAge: 75,
  shockAmount: 30000000,
};

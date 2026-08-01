import {
  Activity, Banknote, CalendarClock, CalendarMinus, CalendarPlus, CloudRain, Coins, Flame, Gift,
  HandCoins, Leaf, PiggyBank, Receipt, Rocket, Shield, ShieldCheck, SlidersHorizontal, Sparkles,
  TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import {
  BequestStrategy, EconomicScenario, HealthcareAssumptions, NationalPensionStrategy, ObjectivePriority,
  PrivatePensionStrategy, RiskProfile, SimulationParams, SpendingStrategyChoice, SpouseProfile,
  StrategyMode, StrategyRecommendation,
} from '../../../core/entities/types';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../../../core/usecases/pension/nationalPensionRules';
import { RadioCardOption } from '../../components/form';
import { EXPECTANCY_MAX } from './ageInput';
import { FieldPath } from './fieldVisibility';

// 6개 섹션이 공유하는 props. 섹션은 자기 값 읽기/쓰기와 노출 판정에 필요한 것만 받는다.
export interface SectionProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
  mode: StrategyMode;
  changed: ReadonlySet<FieldPath>;
}

// AI 추천을 쓰는 섹션들이 공유하는 표면.
//
// 추천 계산(recommendStrategy, 최대 162개 후보 시뮬레이션)은 이 앱에서 가장 무거운 계산이라
// 화면 전체에서 딱 한 번만 돌아야 한다. 계산은 page.tsx가 하고(useDeferredValue로 한 번,
// useBackgroundValue로 한 번 더 미뤄 트랜지션 우선순위에서 돈다) 그 결과가 이 형태로 패널을
// 거쳐 각 섹션에 내려온다 — 패널 안에서 다시 계산하면 같은 결과를 두 번 만든다.
export interface AiRecommendationState {
  recommendation: StrategyRecommendation | null;
  error: string | null;
  // recommendation?.improved의 안전한 별칭. 섹션들이 매번 옵셔널 체이닝하지 않도록 미리 편다.
  improved: boolean;
}

// 배우자 기대수명을 본인 기대수명보다 몇 년 길게 잡을지. 여성 기대수명이 더 길다는
// 통계를 반영한 값이며, 예전 고정 기본값(본인 85 / 배우자 90)의 간격과 같다.
export const SPOUSE_EXPECTANCY_BONUS = 5;

// 배우자 스위치를 처음 켤 때 채워 넣는 값. 나이는 반드시 본인 값에서 유도한다.
//
// 예전에는 고정값(currentAge 50 / expectancy 90)이었고 "BasicInfoSection이 본인 값을 기준으로
// 덮어쓴다"는 주석이 붙어 있었지만 그런 로직은 없었다. 그 결과 65세 사용자가 스위치를 켜면
// 배우자가 50세·90세로 저장되어 deathAtSelfAge = 65 + (90 - 50) = 105가 되고, 시뮬레이션이
// 105세까지 돌았다. householdEndAge가 depletionAge·endingAssets·depletionSafety를 좌우하므로
// 이 한 번의 스위치가 결과 전체를 바꿔 놓는다.
//
// 배우자 나이를 본인 나이와 같게 두는 것은 "모른다"에 대한 가장 중립적인 시작점이며,
// 사용자가 곧바로 옆 입력에서 고칠 수 있다.
export function createDefaultSpouse(
  userProfile: Pick<SimulationParams['userProfile'], 'currentAge' | 'expectancy'>
): SpouseProfile {
  return {
    enabled: false,
    currentAge: userProfile.currentAge,
    expectancy: Math.min(EXPECTANCY_MAX, userProfile.expectancy + SPOUSE_EXPECTANCY_BONUS),
    nationalPensionMonthlyAmount: 0,
    nationalPensionStartAge: NATIONAL_PENSION_NORMAL_START_AGE,
  };
}

// 의료비 스위치를 처음 켤 때 채워 넣는 값.
// 월 30만원은 통계청 가계동향의 60대 이상 보건 지출 수준을 참고한 것이고,
// 증가율 5%는 건강보험 진료비 증가율이 일반 물가를 상회해 온 추세를 반영한다.
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

// SpendingStrategyChoice는 core(entities/types.ts)에 정의되어 있다 —
// strategy.spendingChoice 필드의 타입이라 도메인 쪽이 소유해야 한다.
export const SPENDING_STRATEGY_OPTIONS: ReadonlyArray<RadioCardOption<SpendingStrategyChoice>> = [
  {
    value: 'target', label: '원하는 생활비 직접 입력',
    description: '매달 쓰고 싶은 금액을 정하고, 그 돈이 언제까지 버티는지 봅니다.',
    icon: <Wallet size={16} />, recommended: true,
  },
  {
    value: 'dividend_only', label: '배당금만 소비',
    description: '원금은 건드리지 않고 배당·이자만 씁니다. 자산을 그대로 남깁니다.',
    icon: <Coins size={16} />,
  },
  {
    value: 'max_sustainable', label: '최대 생활비 자동 계산',
    description: '기대수명까지 정확히 다 쓰는 금액을 역산해 알려줍니다.',
    icon: <TrendingUp size={16} />,
  },
  {
    value: 'ai', label: 'AI 추천',
    description: '지금 자산과 목표를 보고 무리 없는 생활비를 제안받습니다.',
    icon: <Sparkles size={16} />,
  },
];

export const OBJECTIVE_OPTIONS: ReadonlyArray<RadioCardOption<ObjectivePriority>> = [
  {
    value: 'lifetime_spending', label: '평생 생활비 확보',
    description: '돈이 떨어지지 않는 것을 가장 중요하게 봅니다.',
    icon: <Wallet size={16} />,
  },
  {
    value: 'tax_minimization', label: '세금 최소화',
    description: '평생 내는 세금과 건강보험료를 줄이는 쪽을 택합니다.',
    icon: <Receipt size={16} />,
  },
  {
    value: 'wealth_maximization', label: '자산 최대화',
    description: '쓰는 속도를 늦춰 자산을 오래 크게 유지합니다.',
    icon: <PiggyBank size={16} />,
  },
  {
    value: 'bequest_maximization', label: '상속 최대화',
    description: '남기는 자산을 최우선으로 두고 계획을 세웁니다.',
    icon: <Gift size={16} />,
  },
  {
    value: 'ai_recommended', label: 'AI 추천',
    description: '목표를 정하지 않고 균형 잡힌 기본 기준으로 계산합니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];

export const BEQUEST_OPTIONS: ReadonlyArray<RadioCardOption<BequestStrategy>> = [
  {
    value: 'spend_all', label: '모두 사용',
    description: '남기지 않고 다 쓰는 것을 목표로 합니다.',
    icon: <HandCoins size={16} />,
  },
  {
    value: 'leave_some', label: '일부 남기기',
    description: '2년치 생활비 정도를 남기는 것을 목표로 합니다.',
    // 기본값(DEFAULT_RETIREMENT_STRATEGY)과 같은 값에 추천 배지를 둔다. 이 앱이 상속 목표를
    // 따로 정하지 않은 계획에 실제로 적용하는 기준이 정확히 "2년치 생활비"다.
    icon: <Banknote size={16} />, recommended: true,
  },
  {
    value: 'maximize', label: '최대 상속',
    description: '가능한 한 많이 남기는 방향으로 평가합니다. 많이 남길수록 점수가 올라갑니다.',
    icon: <Gift size={16} />,
  },
  {
    value: 'target_amount', label: '목표 금액 유지',
    description: '남기고 싶은 금액을 직접 정합니다.',
    icon: <PiggyBank size={16} />,
  },
];

export const NATIONAL_PENSION_OPTIONS: ReadonlyArray<RadioCardOption<NationalPensionStrategy>> = [
  {
    value: 'early', label: '조기 수령 (60세)',
    description: '5년 일찍 받는 대신 매달 받는 금액이 30% 줄어듭니다.',
    icon: <CalendarMinus size={16} />,
  },
  {
    value: 'normal', label: '예상 수령 (65세)',
    description: '원래 받기로 된 나이에 그대로 받습니다.',
    icon: <CalendarClock size={16} />,
  },
  {
    value: 'defer_1y', label: '1년 연기 (66세)',
    description: '1년 늦추면 매달 받는 금액이 7.2% 늘어납니다.',
    icon: <CalendarPlus size={16} />,
  },
  {
    value: 'defer_2y', label: '2년 연기 (67세)',
    description: '2년 늦추면 매달 받는 금액이 14.4% 늘어납니다.',
    icon: <CalendarPlus size={16} />,
  },
  {
    value: 'defer_max', label: '최대 연기 (70세)',
    description: '5년 늦추면 매달 받는 금액이 36% 늘어납니다.',
    icon: <CalendarPlus size={16} />,
  },
  {
    value: 'ai_optimized', label: 'AI 최적화',
    description: '연기 가산과 평생 수령액을 따져 가장 유리한 시점을 찾습니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];

export const PRIVATE_PENSION_OPTIONS: ReadonlyArray<RadioCardOption<PrivatePensionStrategy>> = [
  {
    value: 'tax_first', label: '절세 우선',
    description: '세금이 적게 붙는 한도까지만 꺼내 씁니다.',
    icon: <Shield size={16} />,
  },
  {
    value: 'spending_first', label: '생활비 우선',
    description: '세금보다 생활비를 먼저 채웁니다. 필요한 만큼 꺼냅니다.',
    icon: <Wallet size={16} />,
  },
  {
    value: 'growth_first', label: '자산 성장 우선',
    description: '절반만 꺼내고 나머지는 계좌 안에서 계속 굴립니다.',
    icon: <Rocket size={16} />,
  },
  {
    value: 'minimum', label: '최소 인출',
    // "꼭 필요한 만큼"이 아니다. compileStrategy의 PRIVATE_PENSION_RULES.minimum은
    // withdrawalRatio 0.25로, 실수요와 무관하게 저율과세 한도의 25%를 인출한다.
    description: '저율과세 한도의 25%만 꺼내 연금 잔액을 최대한 지킵니다.',
    icon: <Leaf size={16} />,
  },
  {
    value: 'ai_optimized', label: 'AI 최적화',
    description: '세금과 생활비를 함께 따져 가장 유리한 인출량을 찾습니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];

export const RISK_PROFILE_OPTIONS: ReadonlyArray<RadioCardOption<RiskProfile>> = [
  {
    value: 'conservative', label: '안정형',
    description: '수익은 낮아도 흔들림이 적은 쪽으로 계산합니다. (주식 5%)',
    icon: <ShieldCheck size={16} />,
  },
  {
    value: 'neutral', label: '중립형',
    description: '장기 평균 수준의 수익을 가정합니다. (주식 7%)',
    icon: <Activity size={16} />,
  },
  {
    value: 'aggressive', label: '공격형',
    description: '높은 수익을 가정하되 그만큼 변동도 크다고 봅니다. (주식 9%)',
    icon: <Flame size={16} />,
  },
  {
    value: 'custom', label: '사용자 직접입력',
    description: '자산마다 직접 입력한 수익률을 그대로 씁니다. 프리셋으로 덮어쓰지 않습니다.',
    icon: <SlidersHorizontal size={16} />,
  },
  {
    value: 'ai_recommended', label: 'AI 추천',
    // 나이·은퇴 시점을 보고 프리셋을 고르는 로직은 코드베이스에 없다. compileStrategy의
    // RISK_PROFILE_PRESETS에 'ai_recommended' 항목이 없어 applyYieldPreset이 호출되지
    // 않는 것이 전부다 — 즉 "미정"이며, 아무것도 덮어쓰지 않는다.
    description: '특정 수익률을 강제하지 않고, 직접 입력했거나 경제 시나리오가 정한 수익률을 그대로 둡니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];

export const ECONOMIC_SCENARIO_OPTIONS: ReadonlyArray<RadioCardOption<EconomicScenario>> = [
  {
    value: 'long_term_average', label: '장기 평균',
    description: '지난 수십 년의 평균적인 물가와 성장을 가정합니다.',
    icon: <Activity size={16} />,
  },
  {
    value: 'recession', label: '장기 침체',
    description: '성장이 오래 정체되고 원화가 약해지는 국면입니다.',
    icon: <CloudRain size={16} />,
  },
  {
    value: 'high_inflation', label: '고물가',
    description: '물가가 연 5% 오르는 국면입니다. 실질 구매력이 빠르게 줄어듭니다.',
    icon: <Flame size={16} />,
  },
  {
    value: 'low_growth', label: '저성장',
    description: '물가는 안정적이지만 자산이 잘 늘지 않는 국면입니다.',
    icon: <TrendingDown size={16} />,
  },
  {
    value: 'ai_recommended', label: 'AI 추천',
    // 이 선택지는 '장기 평균'과 의미가 다르다. '장기 평균'은 프로필이 있어 물가·환율·수익률을
    // 일괄 대체하지만, 'ai_recommended'는 ECONOMIC_SCENARIO_PROFILES에 항목이 없어(=미정)
    // 아무것도 대체하지 않는다. 둘을 "같은 뜻"으로 적어 두면 언젠가 프로필을 채우게 되고,
    // 그 순간 사용자가 경제 가정에 직접 입력한 물가상승률이 조용히 덮어써진다
    // (economicScenarios.ts의 경고 참조).
    description: '특정 국면을 강제하지 않고 경제 가정에 직접 입력한 값을 그대로 사용합니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];

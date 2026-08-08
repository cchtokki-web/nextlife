import {
  Activity, Banknote, CalendarClock, CalendarMinus, CalendarPlus, CloudRain, Coins, Equal, Flame, Gift,
  HandCoins, HeartPulse, Leaf, PiggyBank, Plane, Receipt, Rocket, Shield, ShieldCheck, SlidersHorizontal,
  Sparkles, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import {
  BequestStrategy, EconomicScenario, HealthcareAssumptions, IsaFirstChoice, NationalPensionStrategy, ObjectivePriority,
  PrivatePensionStrategy, RiskProfile, SimulationParams, SpendingShapePreset, SpendingStrategyChoice,
  StrategyMode, StrategyRecommendation,
} from '../../../core/entities/types';
import { RadioCardOption } from '../../components/form';
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
// 추천 계산(recommendStrategy, 최대 218개 후보 시뮬레이션)은 이 앱에서 가장 무거운 계산이라
// 화면 전체에서 딱 한 번만 돌아야 한다. 계산은 page.tsx가 하고(useDeferredValue로 한 번,
// useBackgroundValue로 한 번 더 미뤄 트랜지션 우선순위에서 돈다) 그 결과가 이 형태로 패널을
// 거쳐 각 섹션에 내려온다 — 패널 안에서 다시 계산하면 같은 결과를 두 번 만든다.
export interface AiRecommendationState {
  recommendation: StrategyRecommendation | null;
  error: string | null;
  // recommendation?.improved의 안전한 별칭. 섹션들이 매번 옵셔널 체이닝하지 않도록 미리 편다.
  improved: boolean;
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
    value: 'max_sustainable', label: '평생 소비 최적화',
    // 예전 문구는 "기대수명까지 정확히 다 쓰는 금액"이었다. 그 설명은 상속 목표를 함께
    // 설정했을 때 이 모드가 실제로 하는 일 — 목표 잔여자산을 남기면서 역산 — 을 감췄고,
    // 아래 소비 성향으로 연령대별 배분까지 정할 수 있게 된 지금은 더 어긋난다.
    description: '남기고 싶은 자산과 소비 성향을 정하면, 연령대별로 쓸 수 있는 금액을 역산합니다.',
    icon: <TrendingUp size={16} />,
  },
  {
    value: 'ai', label: '생활비 제안 받기',
    // compileStrategy가 'ai'를 baseline인 'target'으로 내린다. 즉 제안은 옆 필드에 힌트로만
    // 뜨고, 계산에 들어가는 것은 사용자가 입력한 목표 생활비다.
    description: '지금 자산과 목표를 보고 무리 없는 생활비를 제안합니다. 계산에는 입력한 목표 생활비가 그대로 쓰입니다.',
    icon: <Sparkles size={16} />,
  },
];

// 은퇴 후 생활비를 연령대별로 어떻게 배분할지. 「평생 소비 최적화」에서만 보인다 —
// 다른 전략에서는 인출액을 목표 생활비나 배당액이 정하므로 배분을 논할 자리가 없다.
//
// 사용자가 고르는 것은 "얼마"가 아니라 "모양"이다. 실제 금액은 자산에서 역산된다.
export const SPENDING_SHAPE_OPTIONS: ReadonlyArray<RadioCardOption<SpendingShapePreset>> = [
  {
    value: 'flat', label: '실질생활비 균등형',
    description: '구매력 기준으로 매년 같은 금액을 씁니다.',
    icon: <Equal size={16} />, recommended: true,
  },
  {
    value: 'front_loaded', label: '활동기 집중형',
    description: '건강한 60대에 더 쓰고 나이가 들수록 줄입니다. 여행·취미를 앞당기고 싶을 때.',
    icon: <Plane size={16} />,
  },
  {
    value: 'care_heavy', label: '의료·돌봄 대비형',
    description: '초반을 아껴 80대 이후를 두텁게 합니다. 간병·요양 비용이 걱정될 때.',
    icon: <HeartPulse size={16} />,
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
    value: 'ai_recommended', label: '균형 있게 평가',
    description: '목표를 하나로 정하지 않고, 어느 목표로 봐도 크게 아쉽지 않은 계획을 고릅니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];

export const BEQUEST_OPTIONS: ReadonlyArray<RadioCardOption<BequestStrategy>> = [
  {
    value: 'spend_all', label: '모두 사용',
    description: '남기지 않고 다 쓰는 것을 목표로 평가합니다.',
    icon: <HandCoins size={16} />,
  },
  {
    value: 'leave_some', label: '일부 남기기',
    // "목표로 합니다"가 아니다. 이 값은 엔진에 하한선을 걸지 않고 채점 기준만 정한다 —
    // 기본값이라 하한선을 걸면 전략을 저장한 적 없는 모든 시나리오의 곡선이 조용히 바뀐다.
    description: '2년치 생활비 정도를 적정선으로 보고 평가합니다. 인출을 따로 제한하지는 않습니다.',
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
    // 이 값만 엔진에 실제 제약(assetFloor)을 건다. 남은 자산이 그 금액 밑으로 내려가는
    // 인출을 하지 않으므로, 지키려면 생활비가 줄어든다. 그 대가를 문구가 밝혀야 한다.
    description: '남기고 싶은 금액을 정하면 그 금액이 남도록 인출을 조절합니다. 모자라면 생활비가 줄어듭니다.',
    icon: <PiggyBank size={16} />,
  },
];

// ISA 만기 자금의 행선지.
//
// 예전에는 "ISA 먼저 사용 / ISA 만기 자금을 연금으로 옮기지 않고 생활비로 먼저 씁니다"라는
// 스위치였다. **엔진은 그런 일을 하지 않는다.** SimulationEngine이 실제로 하는 것은 만기 자금의
// 이동처를 정하는 것뿐이고(연금 계좌 vs 일반 자산), 인출 순서를 앞당기지는 않는다.
// 일반 자산으로 옮기면 연금 인출 나이 제한 없이 바로 쓸 수 있다는 것이 실질적인 차이다.
export const ISA_FIRST_OPTIONS: ReadonlyArray<RadioCardOption<IsaFirstChoice>> = [
  {
    value: 'pension_first', label: '연금 계좌로',
    description: 'ISA 만기 자금을 사적연금 계좌로 옮깁니다. 과세가 미뤄지는 대신 연금 인출 나이 제한을 받습니다.',
    icon: <PiggyBank size={16} />,
  },
  {
    value: 'isa_first', label: '일반 자산으로',
    description: 'ISA 만기 자금을 일반 자산으로 옮깁니다. 나이 제한 없이 바로 쓸 수 있습니다.',
    icon: <Wallet size={16} />,
  },
  {
    value: 'ai_optimized', label: '자동으로 선택',
    description: '두 행선지를 비교해 더 나은 쪽을 계산에 자동 반영합니다. 조건이 바뀌면 다시 선택합니다.',
    icon: <Sparkles size={16} />, recommended: true,
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
    value: 'ai_optimized', label: '자동으로 선택',
    // compileStrategy 단계에서는 정상 개시 나이를 기준선으로 쓰고, 추천이 도착하면
    // applyAiSentinels가 개선이 검증된 나이를 실제 시뮬레이션 입력에 덮어쓴다.
    description: '수령 시점을 비교해 더 나은 나이를 계산에 자동 반영합니다. 조건이 바뀌면 다시 선택합니다.',
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
    value: 'ai_optimized', label: '자동으로 선택',
    // compileStrategy 단계에서는 명시적 인출량을 두지 않고, 추천이 도착하면
    // applyAiSentinels가 개선이 검증된 월 인출 목표를 실제 시뮬레이션 입력에 덮어쓴다.
    // 섹션의 수동 「추천값 반영」 버튼은 격자값을 네 개의 확정 전략으로 역매핑할 수 없어
    // 이 축을 확정하지 않지만, 자동 선택 상태에서는 저수준 계산값으로 안전하게 반영할 수 있다.
    description: '여러 인출 금액을 비교해 더 나은 금액을 계산에 자동 반영합니다. 조건이 바뀌면 다시 선택합니다.',
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
    value: 'ai_recommended', label: '입력 수익률 유지',
    // 나이·은퇴 시점을 보고 프리셋을 고르는 로직은 코드베이스에 없다. compileStrategy의
    // RISK_PROFILE_PRESETS에 'ai_recommended' 항목이 없어 applyYieldPreset이 호출되지
    // 않는 것이 전부다 — 즉 "미정"이며, 아무것도 덮어쓰지 않는다.
    description: '수익률을 강제하지 않고 입력값을 그대로 둡니다. 대신 높고 낮은 수익률 가정 모두에서 견디는 인출 계획을 고릅니다.',
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
    value: 'ai_recommended', label: '직접 입력값 유지',
    // 이 선택지는 '장기 평균'과 의미가 다르다. '장기 평균'은 프로필이 있어 물가·환율·수익률을
    // 일괄 대체하지만, 'ai_recommended'는 ECONOMIC_SCENARIO_PROFILES에 항목이 없어(=미정)
    // 아무것도 대체하지 않는다. 둘을 "같은 뜻"으로 적어 두면 언젠가 프로필을 채우게 되고,
    // 그 순간 사용자가 경제 가정에 직접 입력한 물가상승률이 조용히 덮어써진다
    // (economicScenarios.ts의 경고 참조).
    description: '특정 국면을 강제하지 않고 입력한 값을 그대로 사용합니다. 대신 네 가지 경기 국면 모두에서 견디는 인출 계획을 고릅니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];

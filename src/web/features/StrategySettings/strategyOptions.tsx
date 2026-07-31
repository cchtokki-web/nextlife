import { Banknote, Coins, Gift, HandCoins, PiggyBank, Receipt, Sparkles, TrendingUp, Wallet } from 'lucide-react';
import {
  BequestStrategy, ObjectivePriority, SimulationParams, SpendingStrategyChoice, SpouseProfile, StrategyMode,
} from '../../../core/entities/types';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../../../core/usecases/pension/nationalPensionRules';
import { RadioCardOption } from '../../components/form';
import { FieldPath } from './fieldVisibility';

// 6개 섹션이 공유하는 props. 섹션은 자기 값 읽기/쓰기와 노출 판정에 필요한 것만 받는다.
export interface SectionProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
  mode: StrategyMode;
  changed: ReadonlySet<FieldPath>;
}

// 배우자 스위치를 처음 켤 때 채워 넣는 값.
// currentAge/expectancy는 BasicInfoSection이 본인 값을 기준으로 덮어쓴다.
export const DEFAULT_SPOUSE: SpouseProfile = {
  enabled: false,
  currentAge: 50,
  expectancy: 90, // 여성 기대수명이 더 길다는 통계를 반영해 본인 기본값(85)보다 높게 둔다.
  nationalPensionMonthlyAmount: 0,
  nationalPensionStartAge: NATIONAL_PENSION_NORMAL_START_AGE,
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
    icon: <Banknote size={16} />,
  },
  {
    value: 'maximize', label: '최대 상속',
    description: '가능한 한 많이 남기는 방향으로 평가합니다.',
    icon: <Gift size={16} />, recommended: true,
  },
  {
    value: 'target_amount', label: '목표 금액 유지',
    description: '남기고 싶은 금액을 직접 정합니다.',
    icon: <PiggyBank size={16} />,
  },
];

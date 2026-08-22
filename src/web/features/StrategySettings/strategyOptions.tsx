import {
  Activity, CalendarClock, CalendarMinus, CalendarPlus, CloudRain, Equal, Flame,
  HeartPulse, Leaf, PiggyBank, Plane, Rocket, Shield, SlidersHorizontal,
  Sparkles, TrendingDown, Wallet,
} from 'lucide-react';
import {
  DividendStrategy, EconomicScenario, IsaFirstChoice, NationalPensionStrategy,
  PrivatePensionStrategy, RiskProfile, SimulationParams,
  SpendingShapePreset, StrategyMode, StrategyRecommendation,
} from '../../../core/entities/types';
import { RadioCardOption } from '../../components/form';
// 라벨은 core가 소유한다. 설정 화면과 결과 화면의 가정 공시가 각자 문자열을 들고 있으면,
// 사용자가 고른 이름과 결과에 찍히는 이름이 갈릴 수 있다. 아이콘과 설명문은 화면의 것이다.
import { ECONOMIC_SCENARIO_LABELS } from '../../../core/usecases/scenario/economicScenarios';
import { RISK_PROFILE_LABELS } from '../../../core/usecases/strategy/compileStrategy';
import { FieldPath } from './fieldVisibility';

// 각 섹션이 공유하는 props. 섹션은 자기 값 읽기/쓰기와 노출 판정에 필요한 것만 받는다.
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
// 값의 근거는 core 쪽 정의에 있다. 저장 데이터 정제도 같은 값을 써야 해서 그쪽으로 옮겼다.
export { DEFAULT_HEALTHCARE } from '../../../core/usecases/healthcare/defaultHealthcare';

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

// 배당을 다시 사들일지 현금으로 받을지.
//
// 저장은 여전히 자산별로 되지만(InvestmentAsset.reinvestDividend), 그것을 «누가 정하는가»가
// 이 축이다. 자산마다 손으로 정하는 화면은 전문가 모드에만 남는다 — 목표 기반 흐름에서
// 자산 입력 단계는 「내 자산이 이렇다」는 사실을 받는 자리이고, 재투자 여부는 사실이 아니라
// 인출 전략의 일부이기 때문이다.
export const DIVIDEND_OPTIONS: ReadonlyArray<RadioCardOption<DividendStrategy>> = [
  {
    value: 'ai_optimized', label: '자동으로 선택',
    description: '자산마다 재투자와 현금 수령을 비교해, 지금 계획보다 나아지는 쪽만 계산에 반영합니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
  {
    value: 'reinvest_all', label: '전부 재투자',
    description: '받은 배당을 쓰지 않고 다시 사들여 복리로 굴립니다. 생활비로 쓰려면 자산을 팔아야 합니다.',
    icon: <Rocket size={16} />,
  },
  {
    value: 'cash_all', label: '전부 현금 수령',
    description: '배당을 현금으로 받아 그해 생활비에 씁니다. 그만큼 자산을 덜 팔아도 됩니다.',
    icon: <Wallet size={16} />,
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

/**
 * 은퇴 후 목표 생활비를 나이대별로 어떻게 나눌지.
 *
 * 입력한 금액은 언제나 «60대에 쓸 금액»이고, 세 곡선은 그 뒤로 얼마나 줄어드는지만 다르다
 * (배수와 출처는 spendingCurve.ts가 소유한다). 설명에 감소폭을 적어 두는 이유: 이 선택이
 * 「목표 생활비 350만원」의 뜻을 나이대별로 바꾸므로, 고르는 자리에서 얼마나 바뀌는지
 * 보이지 않으면 총액을 정한 화면과 어긋나 읽힌다.
 */
export const SPENDING_SHAPE_OPTIONS: ReadonlyArray<RadioCardOption<SpendingShapePreset>> = [
  {
    value: 'flat', label: '일정하게 유지',
    description: '은퇴 후 모든 나이에 같은 금액을 씁니다. 가장 보수적인 가정입니다.',
    icon: <Equal size={16} />, recommended: true,
  },
  {
    value: 'front_loaded', label: '통계 기준으로 감소',
    description: '국민연금 적정생활비 조사를 따릅니다. 70대 −14%, 80대 이후 −24%.',
    icon: <Plane size={16} />,
  },
  {
    value: 'care_heavy', label: '완만하게 감소',
    description: '의료·돌봄 부담이 커서 통계만큼 줄지 않는 경우. 70대 −7%, 80대 이후 −12%.',
    icon: <HeartPulse size={16} />,
  },
];

export const RISK_PROFILE_OPTIONS: ReadonlyArray<RadioCardOption<RiskProfile>> = [
  {
    value: 'custom', label: RISK_PROFILE_LABELS.custom,
    description: '자산마다 직접 입력한 수익률을 그대로 씁니다. 그 값 하나로만 평가하며, 여러 가정에서의 검증은 건너뜁니다.',
    icon: <SlidersHorizontal size={16} />,
  },
  {
    value: 'ai_recommended', label: RISK_PROFILE_LABELS.ai_recommended,
    // compileStrategy는 어느 RiskProfile 값에도 수익률 프리셋을 적용하지 않는다 —
    // 그 경로는 삭제됐다(RISK_PROFILE_PRESETS는 더 이상 존재하지 않고, applyYieldPreset도
    // compileStrategy에서 호출되지 않는다). 두 선택지의 차이는 오직 검증 방식이다:
    // 'ai_recommended'는 입력 수익률을 그대로 둔 채 robustness.ts가 conservative/base/
    // aggressive 세 가정의 사본을 만들어 최악의 경우에도 버티는 인출 계획을 고르고,
    // 'custom'은 그 검증을 건너뛰고 입력값 하나로만 평가한다.
    description: '입력한 수익률을 그대로 씁니다. 대신 높고 낮은 수익률 가정 모두에서 견디는 인출 계획을 고릅니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];

export const ECONOMIC_SCENARIO_OPTIONS: ReadonlyArray<RadioCardOption<EconomicScenario>> = [
  {
    value: 'long_term_average', label: ECONOMIC_SCENARIO_LABELS.long_term_average,
    description: '물가 2.5%, 환율 기준선을 가정합니다.',
    icon: <Activity size={16} />,
  },
  {
    value: 'recession', label: ECONOMIC_SCENARIO_LABELS.recession,
    description: '물가 1.5%, 원화 약세를 가정합니다.',
    icon: <CloudRain size={16} />,
  },
  {
    value: 'high_inflation', label: ECONOMIC_SCENARIO_LABELS.high_inflation,
    description: '물가 5%, 원화 약세를 가정합니다. 실질 구매력이 빠르게 줄어듭니다.',
    icon: <Flame size={16} />,
  },
  {
    value: 'low_growth', label: ECONOMIC_SCENARIO_LABELS.low_growth,
    description: '물가 2%, 환율 기준선을 가정합니다.',
    icon: <TrendingDown size={16} />,
  },
  {
    value: 'ai_recommended', label: ECONOMIC_SCENARIO_LABELS.ai_recommended,
    // 이 선택지는 '장기 평균'과 의미가 다르다. '장기 평균'은 프로필이 있어 물가·환율을
    // 일괄 대체하지만, 'ai_recommended'는 ECONOMIC_SCENARIO_PROFILES에 항목이 없어(=미정)
    // 아무것도 대체하지 않는다. 둘을 "같은 뜻"으로 적어 두면 언젠가 프로필을 채우게 되고,
    // 그 순간 사용자가 경제 가정에 직접 입력한 물가상승률이 조용히 덮어써진다
    // (economicScenarios.ts의 경고 참조).
    description: '입력한 물가·환율을 그대로 씁니다. 대신 네 가지 경기 국면 모두에서 견디는 인출 계획을 고릅니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];

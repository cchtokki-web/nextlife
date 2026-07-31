import { SimulationParams, SpouseProfile, StrategyMode } from '../../../core/entities/types';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../../../core/usecases/pension/nationalPensionRules';
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

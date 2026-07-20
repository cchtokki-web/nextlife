import { UtilityBreakdown } from '../../../core/entities/types';
import { DEFAULT_UTILITY_CONFIG } from '../../../core/usecases/utility/utilityWeights';

// Lifetime Utility Score 6개 구성요소의 표시 라벨/배점/색상. 웹 대시보드(UtilityCard)와
// PDF 리포트가 이 하나의 소스를 공유해 두 화면의 표기가 어긋나지 않도록 한다.
export interface UtilityComponentMetaItem {
  key: keyof UtilityBreakdown['components'];
  label: string;
  max: number;
  color: string;
}

// max는 DEFAULT_UTILITY_CONFIG.weights를 그대로 참조한다 — 별도로 하드코딩하면 가중치를
// 튜닝할 때 이 파일을 깜빡 잊고 값이 어긋날 수 있다.
const { weights } = DEFAULT_UTILITY_CONFIG;

export const UTILITY_COMPONENT_META: UtilityComponentMetaItem[] = [
  { key: 'consumption', label: '소비 만족도', max: weights.consumption, color: '#6366F1' },
  { key: 'depletionSafety', label: '자산 고갈 방지', max: weights.depletionSafety, color: '#10B981' },
  { key: 'pensionUtilization', label: '연금 활용도', max: weights.pensionUtilization, color: '#A855F7' },
  { key: 'taxEfficiency', label: '세금 효율', max: weights.taxEfficiency, color: '#06B6D4' },
  { key: 'taxationRisk', label: '과세 위험 관리', max: weights.taxationRisk, color: '#F59E0B' },
  { key: 'bequestAdequacy', label: '상속 자산 적정성', max: weights.bequestAdequacy, color: '#EC4899' },
];

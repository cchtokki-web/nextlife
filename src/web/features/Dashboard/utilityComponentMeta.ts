import { UtilityBreakdown } from '../../../core/entities/types';

// Lifetime Utility Score 6개 구성요소의 표시 라벨/배점/색상. 웹 대시보드(UtilityCard)와
// PDF 리포트가 이 하나의 소스를 공유해 두 화면의 표기가 어긋나지 않도록 한다.
export interface UtilityComponentMetaItem {
  key: keyof UtilityBreakdown['components'];
  label: string;
  max: number;
  color: string;
}

export const UTILITY_COMPONENT_META: UtilityComponentMetaItem[] = [
  { key: 'consumption', label: '소비 만족도', max: 35, color: '#6366F1' },
  { key: 'depletionSafety', label: '자산 고갈 방지', max: 20, color: '#10B981' },
  { key: 'pensionUtilization', label: '연금 활용도', max: 15, color: '#A855F7' },
  { key: 'taxEfficiency', label: '세금 효율', max: 10, color: '#06B6D4' },
  { key: 'taxationRisk', label: '과세 위험 관리', max: 10, color: '#F59E0B' },
  { key: 'bequestAdequacy', label: '상속 자산 적정성', max: 10, color: '#EC4899' },
];

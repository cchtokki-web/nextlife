import { UtilityBreakdown, UtilityConfig } from '../../../core/entities/types';

// Lifetime Utility Score 6개 구성요소의 표시 라벨/배점/색상. 웹 대시보드(UtilityCard)와
// PDF 리포트가 이 하나의 소스를 공유해 두 화면의 표기가 어긋나지 않도록 한다.
export interface UtilityComponentMetaItem {
  key: keyof UtilityBreakdown['components'];
  label: string;
  max: number;
  color: string;
}

// max(배점)는 **계획마다 다르다**. 목표 우선순위(strategy.objective)가 가중치를 통째로
// 갈아끼우기 때문이다(OBJECTIVE_WEIGHT_PRESETS). 그래서 상수가 아니라 함수다.
//
// 예전에는 DEFAULT_UTILITY_CONFIG.weights를 모듈 로드 시점에 고정한 상수였다. 그 결과
// '세금 최소화'(세금 효율 25 / 과세 위험 15)를 고른 사용자의 화면에 "세금 효율 21/10",
// "과세 위험 관리 15/10"처럼 만점을 넘긴 분수가 찍히고, 막대는 100%에서 잘려 만점과
// 구분되지 않았다. 같은 원인으로 "현재 전략 분석"의 강점/약점 문장도 틀린 분모를 인용했다.
//
// 넘겨야 할 값은 점수를 실제로 계산한 그 config다 — `compileStrategy(params).utilityConfig.weights`.
// 그 함수는 전략이 없는 계획에서 DEFAULT_UTILITY_CONFIG를 그대로 반환하므로 기존 동작도 보존된다.
export function buildUtilityComponentMeta(weights: UtilityConfig['weights']): UtilityComponentMetaItem[] {
  return [
    { key: 'consumption', label: '소비 만족도', max: weights.consumption, color: '#6366F1' },
    { key: 'depletionSafety', label: '자산 고갈 방지', max: weights.depletionSafety, color: '#10B981' },
    { key: 'pensionUtilization', label: '연금 활용도', max: weights.pensionUtilization, color: '#A855F7' },
    { key: 'taxEfficiency', label: '세금 효율', max: weights.taxEfficiency, color: '#06B6D4' },
    { key: 'taxationRisk', label: '과세 위험 관리', max: weights.taxationRisk, color: '#F59E0B' },
    { key: 'bequestAdequacy', label: '상속 자산 적정성', max: weights.bequestAdequacy, color: '#EC4899' },
  ];
}

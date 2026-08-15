'use client';

import { useCallback, useState } from 'react';
import type { SimulationParams } from '../../core/entities/types';
import type { CandidateRecommendation } from '../../core/recommendation/RecommendationEngine';
import { applyStrategyToParams } from '../../core/usecases/dashboard/applyStrategyToParams';

// 추천 전략을 현재 시나리오에 반영하고, 적용 직전 상태로 되돌린다.
//
// 스냅샷은 이 세션의 메모리에만 둔다. 시나리오 data에 얹으면 자동저장·E2EE 직렬화 경로를
// 함께 건드려야 하는데, 되돌리기는 "방금 누른 버튼을 취소한다"는 짧은 수명의 기능이다.
// 새로고침하면 사라진다 — 화면에는 그 사실을 알리는 문구가 없으므로, 되돌리기 버튼이 보이는
// 동안에만 되돌릴 수 있다는 것이 사용자가 보는 전부다.

/**
 * 화면이 읽는 값. 되돌릴 수 있을 때에만 주어진다.
 *
 * 지금 화면이 쓰는 것은 candidateId뿐이다(추천 카드가 어느 카드에 「적용 해제」를 낼지
 * 고른다). label과 아래 두 라벨 목록은 무엇이 적용되고 무엇이 빠졌는지에 대한 기록으로
 * 남긴다 — 배너를 지우면서 표시 경로가 사라졌을 뿐, 판정 자체는 applyStrategyToParams가
 * 계속 내고 있다.
 */
export interface AppliedStrategySnapshot {
  candidateId: string;
  label: string;
  appliedLabels: readonly string[];
  /** 현재 계획과 다르지만 반영하지 못한 축. 밝히지 않으면 "전체 적용"이 거짓말이 된다. */
  skippedLabels: readonly string[];
}

interface AppliedStrategyRecord extends AppliedStrategySnapshot {
  scenarioId: string;
  /** 적용 직전 params. 되돌리기가 복구할 대상. */
  previousParams: SimulationParams;
  /** 우리가 넣은 params. 아래 무효화 판정의 기준이 된다. */
  appliedParams: SimulationParams;
}

interface UseAppliedStrategyOptions {
  activeParams: SimulationParams;
  activeScenarioId: string | null;
  /** 시나리오 설정을 갱신한다(useScenarios.handleUpdateActiveParams). */
  onChangeParams: (params: SimulationParams) => void;
  /** 같은 params로 재분석을 요청한다. */
  onReanalyze: (params: SimulationParams) => void;
}

export interface UseAppliedStrategyResult {
  /** 되돌릴 수 있는 상태일 때만 값이 있다. */
  snapshot: AppliedStrategySnapshot | null;
  /**
   * 이 추천을 지금 적용하면 실제로 바뀌는 설정이 있는가.
   *
   * 카드가 「달라지는 점」을 세어 판단하게 두면 안 된다. 카드가 받는 params는 센티널이
   * 채운 계산용 값이고 적용 대상은 사용자가 입력한 activeParams라서, 국민연금·투자 성향처럼
   * 센티널이 채우는 축에서는 둘의 판정이 엇갈린다. 그러면 카드가 변경을 보여주는데 눌러도
   * 아무 일이 없거나(침묵 실패), 반대로 적용할 것이 있는데 버튼이 잠긴다.
   */
  canApply: (recommendation: CandidateRecommendation) => boolean;
  applyRecommendation: (recommendation: CandidateRecommendation) => void;
  undo: () => void;
  /** 설정은 건드리지 않고 되돌리기만 없앤다(전체 초기화 등). */
  forget: () => void;
}

export function useAppliedStrategy({
  activeParams,
  activeScenarioId,
  onChangeParams,
  onReanalyze,
}: UseAppliedStrategyOptions): UseAppliedStrategyResult {
  const [record, setRecord] = useState<AppliedStrategyRecord | null>(null);

  // 무효화는 이펙트가 아니라 파생 술어로 판정한다. 이펙트로 지우면 한 커밋 동안
  // 이미 유효하지 않은 「적용 해제」 버튼이 화면에 남는다.
  //
  // handleUpdateActiveParams는 언제나 새 객체를 만들므로, 사용자가 설정을 직접 바꾸면
  // 참조 비교만으로 확실히 잡힌다(page.tsx의 analysisIsCurrent와 같은 관용구다).
  const canUndo = record !== null
    && record.scenarioId === activeScenarioId
    && record.appliedParams === activeParams;

  const canApply = useCallback((recommendation: CandidateRecommendation) => {
    if (activeScenarioId === null) return false;
    return applyStrategyToParams(activeParams, recommendation.candidate).applied.length > 0;
  }, [activeParams, activeScenarioId]);

  const applyRecommendation = useCallback((recommendation: CandidateRecommendation) => {
    // 활성 시나리오가 없으면 handleUpdateActiveParams가 무동작이다. 그대로 두면 설정은
    // 그대로인데 카드만 "적용됨"으로 바뀐다.
    if (activeScenarioId === null) return;

    const outcome = applyStrategyToParams(activeParams, recommendation.candidate);
    if (outcome.applied.length === 0) return;

    // 이 참조 하나만 쓴다. 아래 두 호출이 서로 다른 객체를 받으면 analysisIsCurrent가
    // 깨져 대시보드가 한 프레임 사라진다.
    const next = outcome.params;
    onChangeParams(next);
    onReanalyze(next);
    setRecord((previous) => ({
      scenarioId: activeScenarioId,
      candidateId: recommendation.candidate.candidate.id,
      label: recommendation.label,
      appliedLabels: outcome.applied.map((item) => item.label),
      skippedLabels: outcome.skipped.map((item) => item.label),
      // 전략을 연달아 적용해도 «최초» 원본을 지킨다. 직전 상태로 덮어쓰면 되돌리기가
      // "전략 A 적용 상태"로 돌아가 사용자의 진짜 원본이 영영 사라진다.
      previousParams: previous?.scenarioId === activeScenarioId
        && previous.appliedParams === activeParams
        ? previous.previousParams
        : activeParams,
      appliedParams: next,
    }));
  }, [activeParams, activeScenarioId, onChangeParams, onReanalyze]);

  const undo = useCallback(() => {
    if (!canUndo || !record) return;

    const previous = record.previousParams;
    onChangeParams(previous);
    onReanalyze(previous);
    setRecord(null);
  }, [canUndo, record, onChangeParams, onReanalyze]);

  const forget = useCallback(() => setRecord(null), []);

  return { snapshot: canUndo ? record : null, canApply, applyRecommendation, undo, forget };
}

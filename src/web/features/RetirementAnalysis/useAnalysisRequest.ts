'use client';

import { useEffect, useRef, useState } from 'react';
import type { AnalysisRequest } from './AnalysisRuntime';
import type { SimulationParams } from '../../../core/entities/types';

interface UseAnalysisRequestOptions {
  /** 시나리오 적재가 끝났는가. 끝나기 전에는 복원할 대상이 무엇인지 알 수 없다. */
  isLoaded: boolean;
  activeScenarioId: string | null;
  /** 활성 시나리오의 ScenarioModel.analyzedAt. null이면 이 시나리오는 분석한 적이 없다. */
  analyzedAt: string | null;
  /** 지금 활성 시나리오로 분석 요청을 만든다. 렌더 중에 불리므로 순수해야 한다. */
  buildRequest: () => AnalysisRequest;
  /** 저장된 분석 요청을 현재 params로 복원한 뒤 그 입력 해시를 저장한다. */
  onRestore?: (scenarioId: string, params: SimulationParams) => void;
}

export interface UseAnalysisRequestResult {
  /** null이면 대시보드 대신 안내 문구가 뜬다. */
  request: AnalysisRequest | null;
  /** 「분석 시작」·전략 적용·초기화가 직접 요청을 갈아 끼운다. */
  setRequest: (request: AnalysisRequest | null) => void;
}

/**
 * 분석 요청을 들고 있고, 저장된 「분석함」 표시를 보고 스스로 한 번 세운다.
 *
 * 예전에는 요청이 page.tsx의 평범한 useState였다. 그래서 새로고침이든 재로그인이든 화면은
 * 언제나 "은퇴 계획을 만들어 보세요"로 시작했다 — 설정과 자산은 서버에서 그대로 돌아오는데
 * 결과 화면만 사라져, 사용자에게는 계획이 유실된 것으로 보였다.
 *
 * 복원은 결과를 되살리는 것이 아니라 «다시 계산하는» 것이다. 저장된 params로 같은 파이프라인을
 * 다시 돌리므로 결과가 낡을 여지가 없다(결과를 저장했다면 같은 계획을 말하는 출처가 둘이 된다).
 *
 * 시나리오 «선택»당 한 번만 세운다. 그 뒤의 params 변화는 사용자의 편집이므로, 대시보드는
 * 기존대로 stale로 판정되어 "다시 분석해 주세요"로 물러난다. 초기화가 요청을 지운 뒤에도
 * 같은 이유로 되살아나지 않는다.
 */
export function useAnalysisRequest({
  isLoaded,
  activeScenarioId,
  analyzedAt,
  buildRequest,
  onRestore,
}: UseAnalysisRequestOptions): UseAnalysisRequestResult {
  const [request, setRequest] = useState<AnalysisRequest | null>(null);
  const [restoredScenarioId, setRestoredScenarioId] = useState<string | null>(null);
  const [restoredAnalysis, setRestoredAnalysis] = useState<{
    scenarioId: string;
    params: SimulationParams;
  } | null>(null);
  const onRestoreRef = useRef(onRestore);

  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  // 이펙트가 아니라 활성 시나리오가 바뀐 순간 렌더 중에 조정한다. 이펙트로 하면 안내 문구로
  // 한 번 커밋한 뒤 대시보드로 바뀌어, 복원한 계획이 로드할 때마다 깜빡인다.
  // 루프는 restoredScenarioId 래치가 막는다 — 같은 시나리오에 대해 한 번만 돈다.
  if (isLoaded && activeScenarioId !== null && restoredScenarioId !== activeScenarioId) {
    setRestoredScenarioId(activeScenarioId);
    // 분석한 적 없는 시나리오로 옮겨 왔다면 이전 시나리오의 결과를 지운다. 남겨 두면 그
    // 결과는 어차피 stale로 판정되어 "다시 분석해 주세요"가 뜨는데, 한 번도 분석한 적 없는
    // 시나리오에서 그 문구는 사실이 아니다.
    const restoredRequest = analyzedAt ? buildRequest() : null;
    setRequest(restoredRequest);
    setRestoredAnalysis(restoredRequest
      ? { scenarioId: activeScenarioId, params: restoredRequest.params }
      : null);
  }

  // Persist after commit, never during render. Restoring reruns the current scenario data, so its
  // analysis hash must move with that request; otherwise another scenario selection makes this
  // one look stale again even though it was just recalculated.
  useEffect(() => {
    if (!restoredAnalysis || restoredAnalysis.scenarioId !== activeScenarioId) return;
    onRestoreRef.current?.(restoredAnalysis.scenarioId, restoredAnalysis.params);
  }, [restoredAnalysis, activeScenarioId]);

  return { request, setRequest };
}

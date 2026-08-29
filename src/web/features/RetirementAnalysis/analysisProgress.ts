import type { AnalysisRuntimeValue } from './AnalysisRuntime';

/**
 * 진행 표시 패널의 단계 상태.
 *
 * 'pending'과 'error'를 'done'과 «반드시» 구분한다. 예전에는 'running'이 아닌 모든 상태가
 * 완료로 렌더돼서, 몬테카를로가 실패해도 「시장 변동 검증」 줄이 초록으로 남았다. 바로 아래
 * 대시보드는 같은 실패를 오류로 표시하므로 한 화면이 서로 다른 말을 했다.
 */
export type AnalysisStepState = 'pending' | 'running' | 'done' | 'error';

export interface AnalysisStep {
  label: string;
  state: AnalysisStepState;
}

export const STEP_STATE_LABEL: Record<AnalysisStepState, string> = {
  pending: '대기 중',
  running: '진행 중',
  done: '완료',
  error: '실패',
};

/**
 * 워커 상태를 단계 상태로 옮긴다.
 *
 * 'unsupported'는 이 브라우저에서 그 단계를 «할 수 없다»는 뜻이므로 완료가 아니다. 다만
 * 아래 analysisHasFailed에서는 제외한다 — 단계로서는 끝내지 못한 것이 맞지만, 「이번 분석이
 * 실패했다」와 「이 환경은 원래 못 한다」는 사용자가 할 수 있는 일이 다르다.
 */
export function workerStepState(
  status: 'idle' | 'running' | 'done' | 'error' | 'unsupported',
): AnalysisStepState {
  if (status === 'running') return 'running';
  if (status === 'done') return 'done';
  if (status === 'error' || status === 'unsupported') return 'error';
  return 'pending';
}

export function analysisSteps(analysis: AnalysisRuntimeValue): AnalysisStep[] {
  return [
    // 결정론 시뮬레이션은 동기 계산이라 이 패널이 그려질 시점엔 이미 결과가 있다. 그래도
    // 상태와 무관하게 완료를 박아 두지 않고 실제 결과 유무를 본다 — 하드코딩된 체크는
    // 검사한 적 없는 단계를 검사했다고 말하는 것이다.
    { label: '기본 시뮬레이션', state: analysis.result ? 'done' : 'pending' },
    {
      label: '추천 전략 탐색',
      // isComputingRecommendation은 «진행» 플래그이고 recommendationFailed가 «결과» 플래그다.
      // 진행 플래그는 성공이든 예외든 똑같이 내려가므로, 그것만 보면 실패가 완료로 읽힌다.
      state: analysis.recommendationFailed
        ? 'error'
        : analysis.isComputingRecommendation ? 'running' : 'done',
    },
    { label: '시장 변동 검증', state: workerStepState(analysis.monteCarloStatus) },
    { label: '전략 후보 최적화', state: workerStepState(analysis.strategyOptimizationStatus) },
  ];
}

export function analysisIsRunning(analysis: AnalysisRuntimeValue | null): boolean {
  return !!analysis && (
    analysis.isComputingRecommendation
    || analysis.monteCarloStatus === 'running'
    || analysis.strategyOptimizationStatus === 'running'
  );
}

/**
 * 이번 분석이 실패했는가.
 *
 * 시나리오 배지가 「분석 완료」라고 말해도 되는지, 「분석 시작」을 다시 열어야 하는지,
 * 진행 패널을 계속 띄울지가 모두 이 하나의 답을 쓴다. 세 곳이 각자 판정하면 화면이 서로
 * 다른 말을 하기 시작한다.
 *
 * analyzedAt은 버튼을 누른 순간 기록되므로 실패해도 남는다 — 실패를 아는 것은 실행 중인
 * 이 값뿐이다. 'unsupported'를 세지 않는 이유는 workerStepState의 주석 참고.
 */
export function analysisHasFailed(analysis: AnalysisRuntimeValue | null): boolean {
  return !!analysis && (
    analysis.recommendationFailed
    || analysis.monteCarloStatus === 'error'
    || analysis.strategyOptimizationStatus === 'error'
  );
}

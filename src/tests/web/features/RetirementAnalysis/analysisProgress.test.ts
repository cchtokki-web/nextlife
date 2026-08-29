import { describe, expect, it } from 'vitest';
import {
  analysisHasFailed,
  analysisIsRunning,
  analysisSteps,
  workerStepState,
} from '@/web/features/RetirementAnalysis/analysisProgress';
import type { AnalysisRuntimeValue } from '@/web/features/RetirementAnalysis/AnalysisRuntime';

// 이 판정이 읽는 필드만 담는다. 나머지는 이 모듈이 보지 않으므로 캐스팅으로 채운다.
const runtime = (overrides: Partial<AnalysisRuntimeValue> = {}): AnalysisRuntimeValue => ({
  result: {},
  recommendationFailed: false,
  isComputingRecommendation: false,
  monteCarloStatus: 'done',
  strategyOptimizationStatus: 'done',
  ...overrides,
} as unknown as AnalysisRuntimeValue);

const stateOf = (analysis: AnalysisRuntimeValue, label: string) =>
  analysisSteps(analysis).find((step) => step.label === label)!.state;

describe('workerStepState', () => {
  it('아직 시작하지 않은 단계를 완료로 읽지 않는다', () => {
    expect(workerStepState('idle')).toBe('pending');
  });

  // 예전에는 'running'이 아닌 모든 상태가 완료(초록)로 렌더돼, 실패한 몬테카를로가
  // 끝난 단계처럼 보였다.
  it('실패와 미지원을 완료와 구분한다', () => {
    expect(workerStepState('error')).toBe('error');
    expect(workerStepState('unsupported')).toBe('error');
    expect(workerStepState('done')).toBe('done');
    expect(workerStepState('running')).toBe('running');
  });
});

describe('analysisSteps', () => {
  it('결정론 결과가 없으면 기본 시뮬레이션을 완료라고 하지 않는다', () => {
    expect(stateOf(runtime({ result: undefined }), '기본 시뮬레이션')).toBe('pending');
    expect(stateOf(runtime(), '기본 시뮬레이션')).toBe('done');
  });

  // isComputingRecommendation은 성공이든 예외든 똑같이 내려가는 «진행» 플래그다. 그것만
  // 보면 실패가 완료로 읽힌다 — 결과 플래그를 먼저 본다.
  it('추천 탐색은 진행 플래그가 아니라 결과 플래그를 먼저 본다', () => {
    const failed = runtime({ recommendationFailed: true, isComputingRecommendation: false });
    expect(stateOf(failed, '추천 전략 탐색')).toBe('error');
    expect(stateOf(runtime({ isComputingRecommendation: true }), '추천 전략 탐색')).toBe('running');
    expect(stateOf(runtime(), '추천 전략 탐색')).toBe('done');
  });

  it('네 단계를 순서대로 돌려준다', () => {
    expect(analysisSteps(runtime()).map((step) => step.label)).toEqual([
      '기본 시뮬레이션', '추천 전략 탐색', '시장 변동 검증', '전략 후보 최적화',
    ]);
  });
});

describe('analysisIsRunning', () => {
  it('분석이 없으면 진행 중이 아니다', () => {
    expect(analysisIsRunning(null)).toBe(false);
  });

  it('어느 한 단계라도 돌고 있으면 진행 중이다', () => {
    expect(analysisIsRunning(runtime())).toBe(false);
    expect(analysisIsRunning(runtime({ monteCarloStatus: 'running' }))).toBe(true);
    expect(analysisIsRunning(runtime({ strategyOptimizationStatus: 'running' }))).toBe(true);
    expect(analysisIsRunning(runtime({ isComputingRecommendation: true }))).toBe(true);
  });
});

describe('analysisHasFailed', () => {
  it('분석이 없으면 실패도 아니다', () => {
    expect(analysisHasFailed(null)).toBe(false);
    expect(analysisHasFailed(runtime())).toBe(false);
  });

  // 배지·「분석 시작」 재개방·진행 패널 유지가 모두 이 답 하나를 쓴다. 셋이 각자 판정하면
  // 화면이 서로 다른 말을 한다 — 실제로 몬테카를로 실패 때 패널은 「다시 눌러 주세요」라고
  // 말하는데 그 버튼은 잠겨 있었다.
  it('세 실패를 모두 센다', () => {
    expect(analysisHasFailed(runtime({ monteCarloStatus: 'error' }))).toBe(true);
    expect(analysisHasFailed(runtime({ strategyOptimizationStatus: 'error' }))).toBe(true);
    expect(analysisHasFailed(runtime({ recommendationFailed: true }))).toBe(true);
  });

  // 「이번 분석이 실패했다」와 「이 환경은 원래 못 한다」는 사용자가 할 수 있는 일이 다르다.
  // 미지원을 실패로 세면 워커를 못 쓰는 브라우저는 영원히 「분석 실패」만 보게 된다.
  it('미지원 환경은 이번 분석의 실패로 세지 않는다', () => {
    expect(analysisHasFailed(runtime({ monteCarloStatus: 'unsupported' }))).toBe(false);
    // 단계 표시에서는 여전히 완료가 아니다 — 두 질문의 답이 다르다.
    expect(stateOf(runtime({ monteCarloStatus: 'unsupported' }), '시장 변동 검증')).toBe('error');
  });
});

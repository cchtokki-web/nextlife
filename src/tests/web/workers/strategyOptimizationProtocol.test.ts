import { describe, expect, test } from 'vitest';
import {
  parseOptimizationRequest,
  parseOptimizationResponse,
} from '@/web/workers/strategyOptimizationProtocol';

// postMessage 경계는 이 코드베이스에서 타입이 실제로 지워지는 유일한 지점이다. 구조화 복제는
// 어떤 값이든 전달하므로 MessageEvent<T>의 T는 런타임 보장이 아니고, 여기서 거르지 못한 값은
// 그대로 엔진까지 간다(그리고 requestId를 모르면 오류 응답조차 버려져 UI가 영구히 멈춘다).
describe('parseOptimizationRequest', () => {
  const valid = { kind: 'run', requestId: 1, params: { userProfile: {} } };

  test('올바른 요청은 그대로 통과시킨다', () => {
    expect(parseOptimizationRequest(valid)).toBe(valid);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['문자열', 'run'],
    ['숫자', 42],
    ['배열', []],
  ])('객체가 아닌 %s은 거부한다', (_label, data) => {
    expect(parseOptimizationRequest(data)).toBeNull();
  });

  test('kind가 run이 아니면 거부한다', () => {
    expect(parseOptimizationRequest({ ...valid, kind: 'cancel' })).toBeNull();
    expect(parseOptimizationRequest({ requestId: 1, params: {} })).toBeNull();
  });

  test('requestId가 숫자가 아니면 거부한다', () => {
    // 응답을 되돌릴 주소가 없으면 오류조차 전달할 수 없다.
    expect(parseOptimizationRequest({ ...valid, requestId: '1' })).toBeNull();
    expect(parseOptimizationRequest({ kind: 'run', params: {} })).toBeNull();
  });

  test('params가 객체가 아니면 거부한다', () => {
    // 이 가드가 없으면 undefined가 LegacySimulationAdapter.fromLegacy까지 그대로 흘러간다.
    expect(parseOptimizationRequest({ ...valid, params: undefined })).toBeNull();
    expect(parseOptimizationRequest({ ...valid, params: 'params' })).toBeNull();
  });
});

describe('parseOptimizationResponse', () => {
  test('done 응답은 result가 객체일 때만 통과시킨다', () => {
    const done = { kind: 'done', requestId: 2, result: { rankedCandidates: [] } };
    expect(parseOptimizationResponse(done)).toBe(done);
    expect(parseOptimizationResponse({ kind: 'done', requestId: 2 })).toBeNull();
    expect(parseOptimizationResponse({ kind: 'done', requestId: 2, result: 'x' })).toBeNull();
  });

  test('error 응답은 message가 문자열일 때만 통과시킨다', () => {
    const error = { kind: 'error', requestId: 3, message: 'boom' };
    expect(parseOptimizationResponse(error)).toBe(error);
    expect(parseOptimizationResponse({ kind: 'error', requestId: 3 })).toBeNull();
  });

  test('알 수 없는 kind는 거부한다', () => {
    // 훅이 이를 error로 오해하면 정상 계산이 실패로 뒤집힌다.
    expect(parseOptimizationResponse({ kind: 'progress', requestId: 3 })).toBeNull();
    expect(parseOptimizationResponse({ requestId: 3, result: {} })).toBeNull();
  });

  test('requestId가 없으면 거부한다', () => {
    expect(parseOptimizationResponse({ kind: 'done', result: {} })).toBeNull();
  });
});

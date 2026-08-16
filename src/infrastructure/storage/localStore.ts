import { SimulationParams } from '../../core/entities/types';
import { SIMULATOR_PARAMS_KEY } from './storageKeys';
import { initialParams } from './defaultParams';
import {
  normalizeSimulationParamsWithIssues,
  reportNormalizationIssues,
} from './normalizeSimulationParams';

// 기존 import 경로를 유지한다. 이 모듈에서 initialParams를 가져다 쓰는 곳이 스무 곳이 넘고,
// 순환 참조를 끊자고 그 호출부를 전부 옮길 이유는 없다.
export { initialParams } from './defaultParams';

export const loadParams = (): SimulationParams => {
  if (typeof window === 'undefined') return initialParams;
  try {
    const data = localStorage.getItem(SIMULATOR_PARAMS_KEY);
    if (!data || data === 'undefined' || data === 'null') return initialParams;
    // 예전에는 `userProfile`이 있고 `assets`가 배열이면 통과시켜 그대로 캐스팅했다.
    // 그 두 조건은 «있느냐»만 볼 뿐 «무엇이냐»를 보지 않아, 문자열 수량이나 NaN 이율이
    // 검사 없이 엔진까지 갔다. 정제는 normalizeSimulationParams 한 곳이 맡는다.
    const { params, issues } = normalizeSimulationParamsWithIssues(JSON.parse(data));
    reportNormalizationIssues('localStorage', issues);
    return params;
  } catch (e) {
    // 여기 오는 것은 JSON.parse 실패(잘린 저장)나 localStorage 접근 거부다. 둘 다 기본값으로
    // 시작하게 되는데, 원본을 그대로 두면 다음 자동 저장이 그 위를 덮어 복구할 수 없게 된다.
    // 읽지 못한 원문을 따로 챙겨 두고, 그 사실을 로그에 남긴다.
    console.error('Failed to load simulation params from LocalStorage:', e);
    stashUnreadableParams();
  }
  return initialParams;
};

/**
 * 읽지 못한 저장값을 별도 키로 옮겨 둔다.
 *
 * 기본값으로 시작하는 것 자체는 맞다 — 읽을 수 없는 데이터로는 아무것도 계산할 수 없다.
 * 문제는 그 다음이다: 화면이 기본값을 사용자의 계획으로 보여 주고, 첫 입력이 자동 저장을
 * 트리거해 원본을 덮는다. 그 시점에 복구 가능성이 사라진다. 옮겨 두면 최소한 남는다.
 */
function stashUnreadableParams(): void {
  try {
    const raw = localStorage.getItem(SIMULATOR_PARAMS_KEY);
    if (!raw) return;
    localStorage.setItem(`${SIMULATOR_PARAMS_KEY}-unreadable`, raw);
  } catch {
    // 여기서 또 실패하면 localStorage 자체를 쓸 수 없는 상황이라 할 수 있는 일이 없다.
    // 원래 오류는 위에서 이미 보고했다.
  }
}

export const saveParams = (params: SimulationParams): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SIMULATOR_PARAMS_KEY, JSON.stringify(params));
  } catch (e) {
    console.error('Failed to save simulation params to LocalStorage:', e);
  }
};

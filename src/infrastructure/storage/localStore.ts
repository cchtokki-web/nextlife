import { SimulationParams } from '../../core/entities/types';
import { SIMULATOR_PARAMS_KEY } from './storageKeys';
import { initialParams } from './defaultParams';
import { normalizeSimulationParams } from './normalizeSimulationParams';

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
    return normalizeSimulationParams(JSON.parse(data));
  } catch (e) {
    console.error('Failed to load simulation params from LocalStorage:', e);
  }
  return initialParams;
};

export const saveParams = (params: SimulationParams): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SIMULATOR_PARAMS_KEY, JSON.stringify(params));
  } catch (e) {
    console.error('Failed to save simulation params to LocalStorage:', e);
  }
};

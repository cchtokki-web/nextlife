import type { SimulationParams } from '../entities/types';

/**
 * 분석 당시 입력과 현재 입력이 같은지 비교하기 위한 표시용 해시.
 * 보안 목적이 아니며, 시나리오 평문을 저장하지 않고 변경 여부만 식별한다.
 */
export function scenarioAnalysisHash(params: SimulationParams): string {
  const stableSerialize = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  };
  const serialized = stableSerialize(params);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

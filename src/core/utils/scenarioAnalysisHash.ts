import type { SimulationParams } from '../entities/types';

/**
 * 직렬화 규칙과 해시 알고리즘의 버전.
 *
 * 해시 앞에 이 태그를 붙이는 이유는 하위호환이다. 저장된 해시의 «의미»는 아래 직렬화
 * 규칙과 FNV 상수에 통째로 의존하므로, 그 중 하나만 고쳐도 이미 저장된 모든 해시가
 * 일제히 어긋난다. 태그가 없으면 그 배포 순간 전 사용자의 모든 시나리오가 한꺼번에
 * 「재분석 필요」로 뒤집히는데 실패하는 테스트는 하나도 없다.
 *
 * 규칙을 바꿀 때 이 값을 올리면 옛 해시는 isComparableScenarioAnalysisHash에서 걸러져
 * 「해시 없음」으로 떨어지고, 판정은 analyzedAt만 보던 예전 동작으로 안전하게 되돌아간다.
 */
export const SCENARIO_ANALYSIS_HASH_VERSION = 'v1';

/**
 * 이 해시로 신선도를 판정해도 되는 값인지 본다.
 *
 * 버전이 다르거나 없는 값(이 필드가 생기기 전에 저장된 행 포함)은 «틀린 답»이 아니라
 * «알 수 없음»이다. 비교에 쓰면 안 된다.
 */
export function isComparableScenarioAnalysisHash(hash: string | null | undefined): boolean {
  return typeof hash === 'string' && new RegExp(`^${SCENARIO_ANALYSIS_HASH_VERSION}:[0-9a-f]{16}$`).test(hash);
}

/**
 * 계산에 쓰이지 않는 «표시용» 최상위 필드.
 *
 * 여기 담긴 값이 바뀌어도 엔진 입력은 그대로다. 해시에 넣으면 수익률 프리셋 표식만 눌러도
 * 「재분석 필요」가 떠서, 배지가 늑대를 외치기 시작하고 사용자는 진짜 경고까지 무시한다.
 * yieldPreset이 계산에 쓰이지 않는다는 것은 types.ts의 선언부에 명시돼 있고,
 * customYieldSnapshot은 「사용자 프리셋」 복원용 저장값이다.
 */
const DISPLAY_ONLY_PARAM_KEYS = ['yieldPreset', 'customYieldSnapshot', 'investmentBaseline', 'autoUpdateEtfPrices'] as const;

/**
 * strategy 안의 표시용 필드. mode는 입력 패널의 공개 수준(간편/표준/전문가)일 뿐이며
 * src/core 어디에서도 계산에 읽지 않는다(compileStrategy의 기본값 자리가 유일한 등장).
 */
const DISPLAY_ONLY_STRATEGY_KEYS = ['mode'] as const;

function omit(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!keys.includes(key)) next[key] = source[key];
  }
  return next;
}

function hashableParams(params: SimulationParams): Record<string, unknown> {
  const next = omit(params as unknown as Record<string, unknown>, DISPLAY_ONLY_PARAM_KEYS);
  if (Array.isArray(next.assets)) {
    next.assets = next.assets.map((asset: unknown) => asset && typeof asset === 'object'
      ? omit(asset as Record<string, unknown>, ['autoHistoricalReturn']) : asset);
  }
  const strategy = next.strategy;
  if (strategy !== null && typeof strategy === 'object') {
    next.strategy = omit(strategy as Record<string, unknown>, DISPLAY_ONLY_STRATEGY_KEYS);
  }
  return next;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      // 값이 undefined인 키는 «없는 키»와 똑같이 적는다. 해시는 메모리의 params로 한 번,
      // 다음 접속에서 복호화된 JSON으로 한 번 계산되는데 JSON 왕복이 그런 키를 통째로
      // 지우기 때문이다. 맞추지 않으면 방금 분석한 시나리오가 새로고침 한 번에 영구히
      // 「재분석 필요」가 된다.
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`;
  }
  // JSON.stringify는 NaN·Infinity·-Infinity를 전부 "null"로 뭉갠다. 뭉개지면 서로 다른 입력이
  // 같은 해시를 받아 «바뀐» 시나리오가 「분석 완료」로 남는다 — 보이는 오류보다 나쁘다.
  if (typeof value === 'number' && !Number.isFinite(value)) return `#${String(value)}`;
  return JSON.stringify(value) ?? 'null';
}

function fnv1a32(input: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 분석 당시 입력과 현재 입력이 같은지 비교하기 위한 표시용 해시.
 *
 * **이 값은 E2EE 계정에서도 서버 행에 그대로 저장된다**(Scenario.analyzedParamsHash).
 * 따라서 출력이 입력을 복원할 수 없는 단방향·고정폭이어야 한다는 것이 이 함수의 계약이다.
 * 암호학적 강도까지 요구하지는 않지만 가역 인코딩으로 대체해서는 안 된다.
 *
 * 폭이 64비트인 이유는 충돌의 «방향» 때문이다. 충돌하면 바뀐 시나리오가 「분석 완료」로
 * 남아 사용자가 옛 입력으로 계산된 금액을 최신이라 믿는다. 32비트에서는 그 확률이
 * 무시하기에 애매했고, 레인을 하나 더 도는 비용은 사실상 없다.
 */
export function scenarioAnalysisHash(params: SimulationParams): string {
  const serialized = stableSerialize(hashableParams(params));
  const lo = fnv1a32(serialized, 2166136261);
  const hi = fnv1a32(serialized, 1099511628211 >>> 0);
  return `${SCENARIO_ANALYSIS_HASH_VERSION}:${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
}

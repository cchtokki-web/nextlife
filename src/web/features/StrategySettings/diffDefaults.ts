import { SimulationParams, StrategyMode } from '../../../core/entities/types';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../core/usecases/strategy/compileStrategy';
import { resolveTaxSettings } from '../../../core/usecases/tax/taxRates';
import { initialParams } from '../../../infrastructure/storage/localStore';
import { FieldPath, SECTION_FIELDS, SectionId, isFieldVisible } from './fieldVisibility';

// 'a.b' 경로로 중첩 값을 읽는다. 중간이 없으면 undefined.
function readPath(source: unknown, path: FieldPath): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, source);
}

// 비교 기준값. 세 곳에서 온다:
//   - taxSettings.*  : resolveTaxSettings()가 채우는 기본 세팅
//   - strategy.*     : DEFAULT_RETIREMENT_STRATEGY
//   - 그 외          : initialParams (앱이 새 시나리오에 넣는 값)
// spouse/healthcare는 initialParams에 없으므로 undefined가 기준이 되고,
// 사용자가 켜는 순간 "변경됨"으로 잡힌다 — 의도한 동작이다.
function readBaseline(path: FieldPath): unknown {
  if (path.startsWith('taxSettings.')) {
    return readPath({ taxSettings: resolveTaxSettings() }, path);
  }
  if (path.startsWith('strategy.')) {
    return readPath({ strategy: DEFAULT_RETIREMENT_STRATEGY }, path);
  }
  return readPath(initialParams, path);
}

// 자산 배열 내부 값을 가리키는 가상 경로. 배열 인덱스별 경로를 만들지 않기 위해
// "자산 중 하나라도 기본값과 다른가"로 축약해 판정한다.
const ASSET_REINVEST_PATH: FieldPath = 'assets.reinvestDividend';

// 최신 환율 자동 조회가 켜져 있는 동안 baseExchangeRate는 사용자가 정한 값이 아니라
// 실시간 시세다(⑤경제 가정을 열 때마다 덮어써지고, 입력도 비활성화된다). 이것을 변경으로
// 세면 사용자가 손대지 않았는데 "1개 변경" / "숨겨진 사용자 설정 1개" 배지가 붙는다.
// 자동 조회를 끄는 순간부터는 환율이 사용자의 선택이 되므로 정상적으로 판정한다.
// useLatestExchangeRate 자신도 함께 제외한다. 껐다가 다시 켜면 값이 명시적 true가 되는데,
// 기준값은 undefined(=켜짐)라서 "기본과 동일한 동작"인데도 변경으로 잡히기 때문이다.
function isAutoFetchedExchangeRate(params: SimulationParams, path: FieldPath): boolean {
  if (params.useLatestExchangeRate === false) return false;
  return path === 'baseExchangeRate' || path === 'useLatestExchangeRate';
}

function isAssetReinvestChanged(params: SimulationParams): boolean {
  const baseline = new Map(initialParams.assets.map((a) => [a.id, a.reinvestDividend]));
  return params.assets.some((a) => {
    const base = baseline.get(a.id);
    // initialParams에 없는 자산(사용자가 추가한 것)은 기준값이 없으므로 변경으로 보지 않는다.
    return base !== undefined && a.reinvestDividend !== base;
  });
}

// 현재 params가 기본값과 다른 필드 경로의 집합.
// FieldRow의 "사용자 설정" 배지와 SettingSection의 변경 개수 배지가 모두 이 결과를 쓴다.
export function collectChangedPaths(params: SimulationParams): ReadonlySet<FieldPath> {
  const changed = new Set<FieldPath>();

  for (const section of Object.keys(SECTION_FIELDS) as SectionId[]) {
    for (const path of SECTION_FIELDS[section]) {
      if (path === ASSET_REINVEST_PATH) {
        if (isAssetReinvestChanged(params)) changed.add(path);
        continue;
      }

      if (isAutoFetchedExchangeRate(params, path)) continue;

      const current = readPath(params, path);
      // 값을 아직 지정하지 않은 필드(undefined)는 "기본값 그대로"로 본다.
      // undefined vs 기본값을 변경으로 잡으면 새 시나리오가 전부 '사용자 설정'이 된다.
      if (current === undefined) continue;
      if (current !== readBaseline(path)) changed.add(path);
    }
  }

  return changed;
}

// 섹션 헤더 배지용. 현재 모드에서 보이는 변경 수와 숨겨진 변경 수를 나눈다.
export function countSectionChanges(
  changed: ReadonlySet<FieldPath>,
  section: SectionId,
  mode: StrategyMode
): { visible: number; hidden: number } {
  let visible = 0;
  let hidden = 0;

  for (const path of SECTION_FIELDS[section]) {
    if (!changed.has(path)) continue;
    if (isFieldVisible(mode, path)) visible += 1;
    else hidden += 1;
  }

  return { visible, hidden };
}

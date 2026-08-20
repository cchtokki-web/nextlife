/**
 * 옛 수익률 키(`annualGrowthRate` / `annualReturn`)를 `totalReturn`으로 옮긴다.
 *
 * **정제(normalizeSimulationParams)보다 «앞»에서 도는 이유**: 정제 결과의 차이를 훑어
 * 이슈를 만드는 collectNormalizationIssues가 raw와 normalized를 비교한다. 옛 키를 정제
 * 안에서 읽으면 그 비교가 「totalReturn이 없었는데 생겼다」를 금액 이슈로 보고해, 옛
 * 시나리오를 열 때마다 거짓 경고가 쏟아진다. 여기서 먼저 키를 옮겨 두면 정제도 이슈
 * 수집도 새 키만 본다.
 *
 * **값을 변환하지 않는다.** 저장된 7은 그대로 7이 되고, 그 7이 이제 총수익률을 뜻한다.
 * 이것은 의도된 정정이다 — 화면이 "예상 연 수익률 7%"라고 말해 온 값이 실제 계산값이
 * 된다. 더하기가 없으므로 몇 번을 적용해도 같은 결과가 나오고, 그래서 스키마 버전
 * 마커가 필요 없다.
 *
 * 새 키가 이미 있으면 그쪽을 이긴다. 두 키가 함께 있는 데이터는 저장된 적이 없지만,
 * 사용자가 직접 고칠 수 있는 localStorage에서 오는 값이므로 규칙을 정해 둔다.
 */
export function migrateLegacyReturnKeys(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;

  const migrated: Record<string, unknown> = { ...raw };
  let changed = false;

  for (const [listKey, legacyKey] of ACCOUNT_LISTS) {
    const list = raw[listKey];
    if (!Array.isArray(list)) continue;

    let listChanged = false;
    const nextList = list.map((item) => {
      if (!isRecord(item)) return item;
      if (!(legacyKey in item)) return item;

      const { [legacyKey]: legacyValue, ...rest } = item;
      listChanged = true;
      // 새 키가 있으면 rest에 이미 들어 있다 — 옛 값으로 덮어쓰지 않는다.
      return 'totalReturn' in rest ? rest : { ...rest, totalReturn: legacyValue };
    });

    if (listChanged) {
      migrated[listKey] = nextList;
      changed = true;
    }
  }

  return changed ? migrated : raw;
}

/** [저장 키, 그 목록이 쓰던 옛 수익률 키] */
const ACCOUNT_LISTS: readonly (readonly [string, string])[] = [
  ['assets', 'annualGrowthRate'],
  ['privatePensions', 'annualReturn'],
  ['isaAccounts', 'annualReturn'],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

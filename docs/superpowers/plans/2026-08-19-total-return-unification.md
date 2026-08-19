# 수익률 총수익률 통일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일반자산·사적연금·ISA의 수익률 필드가 "배당을 포함한 연 총수익률" 하나의 뜻만 갖게 하여, 화면에 표시된 수익률과 엔진이 실제로 쓰는 수익률을 일치시킨다.

**Architecture:** 세 계좌 타입의 수익률 필드를 `totalReturn`으로 통일하고, 총수익률을 가격상승분과 배당분으로 나누는 계산을 `priceGrowthRate` 헬퍼 하나로 모은다. 저장된 시나리오는 로드 직전 pre-pass(`migrateLegacyReturnKeys`)에서 옛 키를 새 키로 옮긴다 — 값 변환이 없으므로 멱등이다. 작업은 "기계적 개명(동작 무변경)" → "의미 전환(동작 변경)" 두 단계로 나눠, 큰 diff와 작은 의미 변화를 따로 리뷰할 수 있게 한다.

**Tech Stack:** TypeScript, Next.js, Vitest, Prisma(시나리오는 JSON blob이라 스키마 변경 없음)

**Spec:** `docs/superpowers/specs/2026-08-19-total-return-unification-design.md`

## Global Constraints

- 금액 단위·명목/실질 규약은 건드리지 않는다. 이번 변경은 `totalReturn`을 어떻게 나누느냐만 바꾸며, 나눈 뒤의 월율 계산(`toMonthlyCompoundRate` 기하 복리 / `divRate` 단리)은 그대로 둔다.
- **사적연금은 분해하지 않는다.** `returnRateAnnual = totalReturn`을 그대로 쓴다. `PrivatePension.dividendYield`는 표시 전용이며 엔진 계산에 쓰이지 않는다.
- 수익률 가정값 자체를 새로 만들지 않는다. 프리셋 상수(`conservative 5/3`, `base 7/4`, `aggressive 9/6`)는 **값을 바꾸지 않고** 필드명만 옮긴다. `predefinedAssets`·`defaultParams`·`SimpleSimulationAdapter`의 하드코딩 값은 `totalReturn = 기존 성장률 + 배당률`로 **원 의도만 보존**해 옮긴다.
- 저장된 시나리오의 계산 결과는 바뀐다(의도된 정정). 저장된 숫자는 값 변환 없이 그대로 `totalReturn`이 된다.
- 테스트 명령: 단일 파일 `npx vitest run <path>`, 전체 `npm test`.
- 커밋 메시지는 한국어, 본문에 "왜"를 적는다(저장소 관례).

---

### Task 1: `priceGrowthRate` 분해 헬퍼

총수익률을 가격상승분으로 바꾸는 유일한 자리를 만든다. 이 태스크는 다른 코드를 건드리지 않으므로 단독으로 그린이다.

**Files:**
- Create: `src/core/usecases/returns/decomposeReturn.ts`
- Test: `src/tests/core/usecases/returns/decomposeReturn.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `priceGrowthRate(totalReturnPercent: number, dividendYieldPercent: number): number` — 둘 다 % 단위(7% → 7), 반환도 % 단위. Task 3(엔진)과 Task 4(UI 파생값 표시)가 이 함수를 쓴다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

Create `src/tests/core/usecases/returns/decomposeReturn.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { priceGrowthRate } from '@/core/usecases/returns/decomposeReturn';

describe('priceGrowthRate', () => {
  test('배당이 총수익률보다 작으면 나머지가 가격상승분이다', () => {
    expect(priceGrowthRate(10.5, 3.5)).toBeCloseTo(7, 10);
  });

  test('배당이 없으면 총수익률 전부가 가격상승분이다', () => {
    expect(priceGrowthRate(7, 0)).toBeCloseTo(7, 10);
  });

  test('배당이 총수익률과 같으면 가격상승분이 0이다', () => {
    expect(priceGrowthRate(7, 7)).toBeCloseTo(0, 10);
  });

  // 커버드콜·고배당 ETF는 분배금이 총수익률을 넘고 그만큼 NAV가 줄어든다.
  // 0으로 자르면 그 상품을 표현할 수 없다.
  test('배당이 총수익률보다 크면 음수가 된다', () => {
    expect(priceGrowthRate(7, 21.2)).toBeCloseTo(-14.2, 10);
  });

  test('총수익률이 음수여도 그대로 계산한다', () => {
    expect(priceGrowthRate(-3, 2)).toBeCloseTo(-5, 10);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/tests/core/usecases/returns/decomposeReturn.test.ts`
Expected: FAIL — `Failed to resolve import "@/core/usecases/returns/decomposeReturn"`

- [ ] **Step 3: 헬퍼를 구현한다**

Create `src/core/usecases/returns/decomposeReturn.ts`:

```ts
/**
 * 총수익률에서 배당분을 뺀 가격상승률(%).
 *
 * **이 함수가 총수익률을 분해하는 유일한 자리다.** 엔진의 일반자산·ISA 초기화와 화면의
 * 파생값 표시가 모두 이 함수를 거친다. 두 곳이 각자 빼기를 하면 반올림·클램프 규칙이
 * 갈라지고, 화면이 말하는 가격상승률과 엔진이 쓰는 가격상승률이 달라진다.
 *
 * **사적연금은 이 함수를 쓰지 않는다.** 연금 계좌 안에서는 배당세도 재투자 선택지도 없어
 * 총수익률만이 결과를 결정하고, 엔진의 두 월율 규약(성장은 기하 복리, 배당은 단리)이
 * 달라서 분해하면 의미 변경을 넘어 산술까지 바뀐다. 설계 문서 3절 참조.
 *
 * 배당률이 총수익률보다 크면 **음수를 그대로 돌려준다.** 분배금이 총수익률을 넘는 만큼
 * NAV가 줄어드는 상품(커버드콜, 일부 고배당 ETF)이 실제로 존재하므로 0으로 자르지 않는다.
 * 자산이 음수로 발산하는 것은 엔진의 `toMonthlyCompoundRate`가 연 −100% 아래를 막아준다.
 *
 * 단위는 둘 다 %다(7% → 7). 소수(0.07)가 아니다.
 */
export function priceGrowthRate(totalReturnPercent: number, dividendYieldPercent: number): number {
  return totalReturnPercent - dividendYieldPercent;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/tests/core/usecases/returns/decomposeReturn.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add src/core/usecases/returns/decomposeReturn.ts src/tests/core/usecases/returns/decomposeReturn.test.ts
git commit -m "$(cat <<'EOF'
feat: 총수익률을 가격상승분으로 나누는 헬퍼를 추가한다

엔진과 화면이 각자 빼기를 하면 화면이 말하는 가격상승률과 엔진이 쓰는
가격상승률이 갈라진다. 분해가 일어나는 자리를 하나로 못박는다.

배당률이 총수익률보다 커도 0으로 자르지 않는다 — 분배금이 총수익률을
넘는 만큼 NAV가 줄어드는 커버드콜·고배당 ETF가 실제로 존재한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 필드 개명과 저장 데이터 마이그레이션 (동작 무변경)

`annualGrowthRate`/`annualReturn`을 `totalReturn`으로 전역 개명하고, 옛 키로 저장된 시나리오가 그대로 열리도록 pre-pass 마이그레이션을 넣는다. **엔진의 계산은 바꾸지 않는다** — 이 태스크가 끝난 시점에도 실효 수익률은 여전히 `totalReturn + dividendYield`다. 전체 테스트가 하나도 수정 없이 그린인 것이 이 태스크의 합격 조건이다.

**Files:**
- Create: `src/infrastructure/storage/migrateLegacyReturnKeys.ts`
- Create: `src/tests/infrastructure/storage/migrateLegacyReturnKeys.test.ts`
- Modify: `src/core/entities/types.ts` (`InvestmentAsset`, `PrivatePension`, `IsaAccount`, `CustomYieldSnapshot` 주석)
- Modify: `src/core/domain/input/retirement.ts` (`AccountProjection` 3종)
- Modify: `src/infrastructure/storage/normalizeSimulationParams.ts` (필드명 + pre-pass 배선)
- Modify: `src/infrastructure/storage/normalizationIssues.ts:44` (`FINANCIAL_LEAVES`에 `totalReturn` 추가)
- Modify: 그 외 `annualGrowthRate`/`annualReturn`을 쓰는 전체 파일(약 80개, 참조 약 420건) — 기계적 치환
- Test: 기존 전체 스위트가 회귀 테스트 역할을 한다

**Interfaces:**
- Consumes: 없음
- Produces:
  - `InvestmentAsset.totalReturn: number`, `PrivatePension.totalReturn: number`, `IsaAccount.totalReturn: number`
  - `AccountProjection.totalReturn: number` (`core/domain/input/retirement.ts`의 investment / private_pension / isa 3종)
  - `migrateLegacyReturnKeys(raw: unknown): unknown` — 옛 키를 새 키로 옮긴 **새 객체**를 돌려준다. 입력을 변형하지 않는다. Task 3 이후에도 이 함수만 옛 데이터를 안다.

- [ ] **Step 1: 마이그레이션의 실패하는 테스트를 작성한다**

Create `src/tests/infrastructure/storage/migrateLegacyReturnKeys.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { migrateLegacyReturnKeys } from '@/infrastructure/storage/migrateLegacyReturnKeys';

describe('migrateLegacyReturnKeys', () => {
  test('자산의 annualGrowthRate를 값 변환 없이 totalReturn으로 옮긴다', () => {
    const raw = { assets: [{ id: 'a', annualGrowthRate: 7, dividendYield: 3 }] };
    const out = migrateLegacyReturnKeys(raw) as typeof raw & {
      assets: { totalReturn: number; annualGrowthRate?: number }[];
    };
    expect(out.assets[0].totalReturn).toBe(7);
    expect('annualGrowthRate' in out.assets[0]).toBe(false);
    expect(out.assets[0].dividendYield).toBe(3);
  });

  test('사적연금과 ISA의 annualReturn도 옮긴다', () => {
    const raw = {
      privatePensions: [{ id: 'p', annualReturn: 4 }],
      isaAccounts: [{ id: 'i', annualReturn: 5, dividendYield: 1.5 }],
    };
    const out = migrateLegacyReturnKeys(raw) as {
      privatePensions: { totalReturn: number }[];
      isaAccounts: { totalReturn: number }[];
    };
    expect(out.privatePensions[0].totalReturn).toBe(4);
    expect(out.isaAccounts[0].totalReturn).toBe(5);
  });

  // 값을 더하지 않으므로 몇 번을 돌려도 같다. 버전 마커가 필요 없는 근거다.
  test('두 번 적용해도 결과가 같다', () => {
    const raw = { assets: [{ id: 'a', annualGrowthRate: 7, dividendYield: 3 }] };
    const once = migrateLegacyReturnKeys(raw);
    const twice = migrateLegacyReturnKeys(once);
    expect(twice).toEqual(once);
  });

  // 원칙: 새 키가 이미 있으면 옛 키는 낡은 잔재다. 새 키를 이긴다.
  test('totalReturn이 이미 있으면 옛 키가 덮어쓰지 않는다', () => {
    const raw = { assets: [{ id: 'a', totalReturn: 10, annualGrowthRate: 7 }] };
    const out = migrateLegacyReturnKeys(raw) as { assets: { totalReturn: number }[] };
    expect(out.assets[0].totalReturn).toBe(10);
  });

  test('입력 객체를 변형하지 않는다', () => {
    const raw = { assets: [{ id: 'a', annualGrowthRate: 7 }] };
    migrateLegacyReturnKeys(raw);
    expect(raw.assets[0]).toEqual({ id: 'a', annualGrowthRate: 7 });
  });

  test('객체가 아니거나 목록이 없으면 그대로 돌려준다', () => {
    expect(migrateLegacyReturnKeys(null)).toBe(null);
    expect(migrateLegacyReturnKeys('x')).toBe('x');
    expect(migrateLegacyReturnKeys({ userProfile: {} })).toEqual({ userProfile: {} });
  });

  test('customYieldSnapshot은 값이 숫자 맵이라 손대지 않는다', () => {
    const raw = { customYieldSnapshot: { assets: { a: 7 }, privatePensions: {}, isaAccounts: {} } };
    expect(migrateLegacyReturnKeys(raw)).toEqual(raw);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/tests/infrastructure/storage/migrateLegacyReturnKeys.test.ts`
Expected: FAIL — `Failed to resolve import "@/infrastructure/storage/migrateLegacyReturnKeys"`

- [ ] **Step 3: 마이그레이션을 구현한다**

Create `src/infrastructure/storage/migrateLegacyReturnKeys.ts`:

```ts
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
 * 된다(설계 문서의 「호환성 결정」). 더하기가 없으므로 몇 번을 적용해도 같은 결과가
 * 나오고, 그래서 스키마 버전 마커가 필요 없다.
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
```

- [ ] **Step 4: 마이그레이션 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/tests/infrastructure/storage/migrateLegacyReturnKeys.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 마이그레이션을 정제 경로에 배선한다**

Modify `src/infrastructure/storage/normalizeSimulationParams.ts`.

임포트를 추가한다(기존 `import { initialParams } from './defaultParams';` 아래):

```ts
import { migrateLegacyReturnKeys } from './migrateLegacyReturnKeys';
```

`normalizeSimulationParamsWithIssues`(57-62행)를 바꾼다. 이슈 수집이 마이그레이션된 raw를 보게 하는 것이 요점이다:

```ts
export function normalizeSimulationParamsWithIssues(raw: unknown): {
  params: SimulationParams;
  issues: NormalizationIssue[];
} {
  // 옛 수익률 키를 먼저 옮긴다. 이슈 수집이 마이그레이션 «전»의 raw를 보면
  // 「totalReturn이 없었는데 생겼다」를 금액 이슈로 잘못 보고한다.
  const migrated = migrateLegacyReturnKeys(raw);
  const params = normalizeSimulationParams(migrated);
  return { params, issues: collectNormalizationIssues(migrated, params) };
}
```

`normalizeSimulationParams`(119행)의 첫 줄에도 넣는다 — 이 함수를 직접 부르는 호출부가 40여 곳이라 여기서도 옛 데이터를 받을 수 있다:

```ts
export function normalizeSimulationParams(rawInput: unknown): SimulationParams {
  const raw = migrateLegacyReturnKeys(rawInput);
  if (!isRecord(raw)) return initialParams;

  return {
    // 원칙 3. 검증한 필드는 아래에서 전부 덮어쓴다.
    ...(raw as unknown as SimulationParams),
    // ... 이하 기존 그대로
```

> `normalizeSimulationParamsWithIssues`가 두 번 부르게 되지만, 마이그레이션이 멱등이라 안전하다(Step 1의 세 번째 테스트가 그것을 고정한다).

- [ ] **Step 6: 전역 개명을 적용한다**

세 필드를 `totalReturn`으로 바꾼다. `annualGrowthRate`와 `annualReturn`은 모두 이 세 타입(및 `AccountProjection`)에서만 쓰이는 이름이라 단어 경계 치환이 안전하다 — 다른 개념에 같은 이름을 쓰는 곳이 없음을 확인했다.

**단, 방금 만든 마이그레이션 파일과 그 테스트는 제외한다.** 그 파일이 옛 이름을 아는 유일한 자리다.

```bash
cd LOCAL_PATH_REDACTED

# 마이그레이션 파일 2개를 제외한 전체
grep -rl --include='*.ts' --include='*.tsx' -E '\b(annualGrowthRate|annualReturn)\b' src \
  | grep -v 'migrateLegacyReturnKeys' \
  | xargs sed -i '' -E 's/\bannualGrowthRate\b/totalReturn/g; s/\bannualReturn\b/totalReturn/g'
```

치환 후 남은 것을 확인한다 — 마이그레이션 파일 2개에서만 나와야 한다:

```bash
grep -rn --include='*.ts' --include='*.tsx' -E '\b(annualGrowthRate|annualReturn)\b' src
```

- [ ] **Step 7: 치환이 만든 중복 키와 이름 충돌을 고친다**

기계 치환은 두 곳에서 깨진 코드를 만든다. 직접 고친다.

**(a) `src/web/features/AssetForm/AssetFormSection.tsx` 283-289행** — 지역 변수명이 필드명과 같아져 `const totalReturn = data.totalReturn || 0;` 꼴이 된다. 지역 변수를 그대로 두어도 동작하지만, 같은 줄에서 `data.totalReturn`을 읽으므로 셰도잉이 헷갈린다. 아래로 정리한다:

```ts
        if (data.totalReturn !== undefined || data.dividendYield !== undefined) {
          const fetchedTotalReturn = data.totalReturn || 0;
          const fetchedDividendYield = data.dividendYield || 0;

          onChangeParams((prevParams: SimulationParams) => {
            const updated = (prevParams.isaAccounts || []).map((isa) => {
              if (isa.id === id) {
                return { ...isa, totalReturn: fetchedTotalReturn, dividendYield: fetchedDividendYield };
              }
              return isa;
            });
            return { ...prevParams, isaAccounts: updated, yieldPreset: 'custom' };
          });
        }
```

254-260행(`fetchPensionInfo`)도 같은 모양이므로 같은 방식으로 고친다.

**(b) `src/core/entities/types.ts` 243-248행 주석** — `annualGrowthRate/annualReturn`이 `totalReturn/totalReturn`이 된다. 주석을 다시 쓴다:

```ts
// 공격적)으로 전환하면 자산·연금·ISA의 totalReturn이 프리셋 값으로 덮어써지므로, 그
```
```ts
  privatePensions: Record<string, number>; // PrivatePension.id -> totalReturn
  // IsaAccount.id -> totalReturn. ISA가 프리셋 대상에 들어오기 전에 저장된 스냅샷에는
```

- [ ] **Step 8: 타입 주석을 새 계약으로 고친다**

Modify `src/core/entities/types.ts`.

`InvestmentAsset`:

```ts
  /** 배당을 포함한 연 총수익률. % 단위, 예: 10.5% -> 10.5 */
  totalReturn: number;
  /**
   * totalReturn 중 현금으로 분배되는 비율. % 단위, 예: 3% -> 3
   *
   * 가격상승률은 `totalReturn - dividendYield`로 파생된다(priceGrowthRate). 이 값이
   * totalReturn보다 크면 가격상승률이 음수가 되며, 커버드콜·고배당 ETF에서 정상이다.
   */
  dividendYield: number;
```

`PrivatePension`:

```ts
  /** 배당을 포함한 연 총수익률. % 단위 */
  totalReturn: number;
  /**
   * 표시 전용. **엔진 계산에 쓰이지 않는다.**
   *
   * 연금 계좌 안에서는 배당세도 재투자 선택지도 없어 총수익률만이 결과를 결정한다.
   * 게다가 엔진의 두 월율 규약이 달라(성장은 기하 복리, 배당은 단리) 분해하면 산술까지
   * 바뀐다. 그래서 이 값은 화면의 파생값 표시와 시세 조회 일관성을 위해서만 존재한다.
   */
  dividendYield?: number;
```

`IsaAccount`:

```ts
  /** 배당을 포함한 연 총수익률. % 단위 */
  totalReturn: number;
  /** totalReturn 중 현금으로 분배되는 비율. % 단위 */
  dividendYield: number;
```

- [ ] **Step 9: 정제 이슈 화이트리스트에 새 이름을 추가한다**

Modify `src/infrastructure/storage/normalizationIssues.ts:42-44`. Step 6의 치환이 이미 옛 두 이름을 `totalReturn`으로 바꿔 중복이 생겼을 수 있으므로, 목록을 다음으로 확정한다:

```ts
const FINANCIAL_LEAVES = new Set([
  'quantity', 'averagePrice', 'balance', 'monthlyContribution', 'contributionAmount',
  'acquisitionCostBasis', 'totalReturn', 'dividendYield',
```

- [ ] **Step 10: 타입 검사와 전체 테스트를 돌린다**

```bash
npx tsc --noEmit
npm test
```

Expected: 타입 오류 0건. **전체 테스트가 하나도 수정 없이 그린.** 이 태스크는 이름만 바꿨고 계산은 그대로이므로, 깨지는 테스트가 있다면 치환이 무언가를 잘못 건드린 것이다 — 개별 조사한다.

- [ ] **Step 11: 커밋한다**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor: 수익률 필드를 totalReturn으로 개명하고 옛 키 마이그레이션을 넣는다

annualGrowthRate라는 이름이 거짓말을 하고 있었다 — 엔진은 그 값을 가격상승률로
읽고 배당을 위에 얹는데, 화면과 리포트는 같은 필드를 "예상 연 수익률"이라고
불렀다. 이름을 고쳐 두지 않으면 다음 사람이 같은 버그를 다시 넣는다.

이 커밋은 이름만 바꾼다. 실효 수익률은 여전히 totalReturn + dividendYield이며,
전체 테스트가 수정 없이 그대로 통과하는 것이 그 근거다. 의미 전환은 다음
커밋에서 한다.

옛 키는 정제보다 앞서 도는 pre-pass에서 옮긴다. 정제 안에서 읽으면
collectNormalizationIssues가 "totalReturn이 없었는데 생겼다"를 금액 이슈로
보고해 옛 시나리오를 열 때마다 거짓 경고가 쏟아진다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 의미 전환 — 엔진 분해와 값 재보정

`totalReturn`이 실제로 총수익률이 되게 한다. **엔진 변경, 값 소스 재보정, 픽스처 이관이 한 커밋에 함께 들어가야 한다** — 어느 하나만 먼저 바꾸면 표시값과 계산값이 어긋난 상태가 커밋으로 남는다.

**Files:**
- Modify: `src/core/usecases/SimulationEngine.ts:419-487` (`initializeAssets`)
- Modify: `src/infrastructure/storage/normalizeSimulationParams.ts` (`deposit`이면 `dividendYield` 0)
- Modify: `src/web/features/AssetForm/predefinedAssets.ts` (33종 값 재보정)
- Modify: `src/infrastructure/storage/defaultParams.ts`
- Modify: `src/core/usecases/SimpleSimulationAdapter.ts:40-70`
- Modify: `src/web/features/AssetForm/AssetFormSection.tsx:149-155, 349, 493` (신규 계좌·실시간 후보 기본값)
- Modify: `src/app/api/stock-info/route.ts:39-108`
- Modify: 배당률이 0이 아닌 픽스처를 가진 테스트 파일 약 52개
- Create: `src/tests/core/usecases/SimulationEngine.totalReturn.test.ts`

**Interfaces:**
- Consumes: `priceGrowthRate(totalReturnPercent, dividendYieldPercent)` (Task 1), `InvestmentAsset.totalReturn` 등 (Task 2)
- Produces: 엔진의 실효 연 수익률 == `totalReturn`. `stock-info` API가 `{ ticker, totalReturn, dividendYield }`를 반환한다(Task 4의 조회 경로가 이 모양에 의존한다).

- [ ] **Step 1: 실패하는 회귀 테스트를 작성한다**

Create `src/tests/core/usecases/SimulationEngine.totalReturn.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import type { InvestmentAsset, IsaAccount, PrivatePension, SimulationParams } from '@/core/entities/types';

// 물가 0·명목 기준으로 두어 수익률 외의 변수를 없앤다. 은퇴 전 1년만 굴리고
// 총자산을 본다 — 인출·세금·연금이 끼어들지 않는 구간이다.
function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 51, targetMonthlySpending: 0 },
    assets: [],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'nominal',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

function asset(over: Partial<InvestmentAsset> = {}): InvestmentAsset {
  return {
    id: 'a1', type: 'etf', ticker: 'A', name: '자산',
    quantity: 1000, averagePrice: 100000,
    totalReturn: 7, dividendYield: 0,
    monthlyContribution: 0, reinvestDividend: true, currency: 'KRW',
    ...over,
  };
}

function terminalAssets(p: SimulationParams): number {
  const years = new SimulationEngine().run(p).yearlyResults;
  return years[years.length - 1].totalAssets;
}

describe('총수익률 통일', () => {
  // 이번 버그의 직접 회귀 테스트. 예전에는 배당률이 총수익률 «위에» 더해져서
  // 총수익률 7%·배당 3%인 자산이 실효 10%로 굴렀다.
  test('일반자산: 배당률은 총수익률을 나눌 뿐 더하지 않는다', () => {
    const withDividend = terminalAssets(params({ assets: [asset({ totalReturn: 7, dividendYield: 3 })] }));
    const withoutDividend = terminalAssets(params({ assets: [asset({ totalReturn: 7, dividendYield: 0 })] }));

    // 성장은 기하 복리, 배당은 단리라 완전히 같지는 않다. 하지만 배당이 통째로
    // 더해지던 예전 동작(약 10% 대 7%)과는 자릿수가 다르게 가까워야 한다.
    expect(withDividend / withoutDividend).toBeCloseTo(1, 2);
  });

  test('ISA: 배당률은 총수익률을 나눌 뿐 더하지 않는다', () => {
    const isa = (dividendYield: number): IsaAccount => ({
      id: 'i1', type: 'general', investmentType: 'custom',
      balance: 100_000_000, monthlyContribution: 0,
      totalReturn: 7, dividendYield, currency: 'KRW', maturityYears: 100,
    });
    const withDividend = terminalAssets(params({ isaAccounts: [isa(3)] }));
    const withoutDividend = terminalAssets(params({ isaAccounts: [isa(0)] }));
    expect(withDividend / withoutDividend).toBeCloseTo(1, 2);
  });

  // 연금은 분해하지 않으므로 dividendYield가 결과에 «전혀» 영향을 주지 않는다.
  // 예전에는 investmentType이 'etf'면 총수익률에 그대로 더해졌다.
  test('사적연금: dividendYield가 결과에 영향을 주지 않는다', () => {
    const pension = (dividendYield: number): PrivatePension => ({
      id: 'p1', type: 'irp', investmentType: 'etf',
      balance: 100_000_000, monthlyContribution: 0,
      totalReturn: 4, dividendYield, currency: 'KRW',
    });
    expect(terminalAssets(params({ privatePensions: [pension(10)] })))
      .toBe(terminalAssets(params({ privatePensions: [pension(0)] })));
  });

  // 예금형 ISA는 화면에 배당 입력칸이 없다. 신규 ISA의 기본 dividendYield가 1.5라
  // 예전에는 예금을 골라도 연 1.5%가 조용히 더 붙었다.
  test('예금형 ISA: 남아 있는 dividendYield가 총합을 늘리지 않는다', () => {
    const isa = (dividendYield: number): IsaAccount => ({
      id: 'i1', type: 'general', investmentType: 'deposit',
      balance: 100_000_000, monthlyContribution: 0,
      totalReturn: 3, dividendYield, currency: 'KRW', maturityYears: 100,
    });
    expect(terminalAssets(params({ isaAccounts: [isa(1.5)] })))
      .toBe(terminalAssets(params({ isaAccounts: [isa(0)] })));
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.totalReturn.test.ts`
Expected: 4개 모두 FAIL — 배당이 총수익률 위에 더해지고 있으므로 비율이 1에서 벗어나고, 연금·예금 테스트는 값이 다르다.

- [ ] **Step 3: 엔진의 초기화를 분해로 바꾼다**

Modify `src/core/usecases/SimulationEngine.ts`.

임포트를 추가한다:

```ts
import { priceGrowthRate } from './returns/decomposeReturn';
```

`initializeAssets`(419행부터)의 세 블록을 바꾼다.

**일반자산**(425-428행):

```ts
      // 총수익률에서 배당분을 뺀 나머지가 가격상승분이다. 배당은 아래 divRateMonthly로
      // 따로 흐르므로, 여기서 빼지 않으면 배당이 두 번 계산된다.
      const priceGrowthPercent = priceGrowthRate(asset.totalReturn, asset.dividendYield);
      const growthRateAnnual = inflationMode === 'real'
        ? (priceGrowthPercent - inflationRate) / 100
        : priceGrowthPercent / 100;
      const growthRateMonthly = toMonthlyCompoundRate(growthRateAnnual);
      const divRateMonthly = (asset.dividendYield / 100) / 12;
```

**사적연금**(455-462행) — `investmentType === 'etf'` 가산을 삭제한다. 분해도 하지 않는다:

```ts
    const activePensions: ActivePension[] = privatePensions.map((p) => {
      // **분해하지 않는다.** 연금 계좌 안에는 배당세도 재투자 선택지도 없어 총수익률만이
      // 결과를 결정하고, 성장(기하 복리)과 배당(단리)의 월율 규약이 달라 분해하면
      // 의미 변경을 넘어 산술까지 바뀐다. p.dividendYield는 표시 전용이다.
      const returnRateAnnual = inflationMode === 'real'
        ? (p.totalReturn - inflationRate) / 100
        : p.totalReturn / 100;
      const returnRateMonthly = toMonthlyCompoundRate(returnRateAnnual);

      return {
        ...p,
        currentBalance: p.balance,
        returnRateAnnual,
        returnRateMonthly,
      };
    });
```

**ISA**(472-477행):

```ts
      const priceGrowthPercent = priceGrowthRate(isa.totalReturn, isa.dividendYield);
      const returnRateAnnual = inflationMode === 'real'
        ? (priceGrowthPercent - inflationRate) / 100
        : priceGrowthPercent / 100;
      const returnRateMonthly = toMonthlyCompoundRate(returnRateAnnual);
      const divRateMonthly = (isa.dividendYield / 100) / 12;
```

- [ ] **Step 4: 예금형 계좌의 배당률을 정제에서 0으로 만든다**

Modify `src/infrastructure/storage/normalizeSimulationParams.ts`.

`normalizeIsaAccount`의 `dividendYield` 줄을 바꾼다. `investmentType`을 먼저 읽어야 하므로 함수 본문을 다음으로 교체한다:

```ts
function normalizeIsaAccount(raw: Record<string, unknown>, index: number): IsaAccount {
  const investmentType = optionalOneOf(raw.investmentType, INVESTMENT_TYPES, undefined);
  return {
    id: text(raw.id, `isa-${index}`),
    type: oneOf(raw.type, ISA_TYPES, 'general'),
    balance: finite(raw.balance, 0),
    monthlyContribution: finite(raw.monthlyContribution, 0),
    totalReturn: finite(raw.totalReturn, 0),
    // 예금형은 화면에 배당 입력칸이 없다(AssetFormSection의 investmentType 분기).
    // 숨은 칸에 값이 남아 있으면 사용자가 볼 수도 고칠 수도 없는 수익률이 된다.
    dividendYield: investmentType === 'deposit' ? 0 : finite(raw.dividendYield, 0),
    currency: currency(raw.currency, 'KRW'),
    ...onlyIfPresent(raw, 'investmentType', (v) => optionalOneOf(v, INVESTMENT_TYPES, undefined)),
    ...onlyIfPresent(raw, 'ticker', optionalText),
    ...onlyIfPresent(raw, 'name', optionalText),
    // 0년 이하 만기는 만기 처리가 매년(혹은 매 시점) 발동하는 뜻이 된다. 금액이 아니라
    // «주기»라서 0을 「없음」으로 읽을 수 없으므로, 타입 주석이 밝힌 기본값 3년을 쓴다.
    // `finite`만 쓰면 0이 유한수라 그대로 통과해 이 주석이 거짓말이 된다.
    maturityYears: positive(raw.maturityYears, 3),
  };
}
```

> 사적연금은 `dividendYield`가 엔진에 닿지 않으므로 손대지 않는다 — 원칙 4(없던 키를 만들지 않는다)를 지키는 쪽이 낫다.

- [ ] **Step 5: 회귀 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.totalReturn.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: 프리셋 종목 값을 총수익률로 재보정한다**

Modify `src/web/features/AssetForm/predefinedAssets.ts`. Task 2의 치환으로 필드명은 이미 `totalReturn`이다. **값만** `기존 성장률 + 배당률`로 올린다. 원 의도(그동안 실제로 그 값으로 계산돼 왔다)를 보존하는 변환이다.

인터페이스 주석을 먼저 고친다:

```ts
export interface PredefinedAsset {
  ticker: string;
  name: string;
  type: 'stock' | 'etf';
  currency: 'USD' | 'KRW';
  /** 배당을 포함한 연 총수익률 %. dividendYield를 빼면 가격상승률이 된다. */
  totalReturn: number;
  dividendYield: number;
}
```

각 종목의 `totalReturn`을 아래 표대로 바꾼다(`dividendYield`는 그대로 둔다):

| ticker | 기존 성장률 | 배당률 | **새 totalReturn** |
|---|---:|---:|---:|
| VOO | 8.0 | 1.4 | **9.4** |
| QQQ | 9.0 | 0.6 | **9.6** |
| SCHD | 7.0 | 3.5 | **10.5** |
| SPY | 8.0 | 1.4 | **9.4** |
| SPLG | 8.0 | 1.4 | **9.4** |
| JEPI | 5.0 | 8.0 | **13.0** |
| TLT | 3.5 | 4.0 | **7.5** |
| VNQ | 5.0 | 4.2 | **9.2** |
| AAPL | 9.0 | 0.5 | **9.5** |
| MSFT | 10.0 | 0.7 | **10.7** |
| NVDA | 12.0 | 0.1 | **12.1** |
| TSLA | 12.0 | 0.0 | **12.0** |
| GOOGL | 9.0 | 0.4 | **9.4** |
| AMZN | 9.0 | 0.0 | **9.0** |
| META | 9.0 | 0.4 | **9.4** |
| O | 4.0 | 5.5 | **9.5** |
| 069500 | 6.0 | 2.0 | **8.0** |
| 360750 | 8.0 | 1.3 | **9.3** |
| 133690 | 9.0 | 0.5 | **9.5** |
| 458730 | 7.0 | 3.5 | **10.5** |
| 476560 | 9.5 | 0.3 | **9.8** |
| 368590 | 8.0 | 1.3 | **9.3** |
| 381170 | 9.5 | 0.3 | **9.8** |
| 005930 | 6.0 | 2.5 | **8.5** |
| 000660 | 8.0 | 1.0 | **9.0** |
| 005380 | 5.0 | 4.5 | **9.5** |
| 035420 | 7.0 | 0.8 | **7.8** |
| 035720 | 7.0 | 0.4 | **7.4** |
| 207940 | 8.0 | 0.0 | **8.0** |
| 373220 | 8.0 | 0.0 | **8.0** |
| 055600 | 4.0 | 5.5 | **9.5** |
| PENSION_DEP | 3.0 | 0.0 | **3.0** |
| PENSION_ETF | 7.0 | 1.5 | **8.5** |

파일 맨 위에 이 변환의 근거를 남긴다:

```ts
// **여기의 totalReturn은 배당을 포함한 값이다.**
//
// 예전에는 이 표가 가격상승률과 배당률을 따로 들고 있었고 엔진이 둘을 더해 굴렸다.
// 즉 SCHD는 언제나 10.5%로 계산돼 왔다. 총수익률 표기로 옮기면서 그 합을 그대로 적었다 —
// 값을 새로 정하지 않고 지금까지의 동작을 보존한 것이다.
//
// 그래서 이 숫자들이 높아 보인다면, 그것은 표기가 바뀌어서가 아니라 원래 그랬던 것이
// 드러난 것이다. 값 자체를 고칠 때는 근거를 함께 적을 것.
```

- [ ] **Step 7: 나머지 하드코딩 기본값을 재보정한다**

**(a) `src/infrastructure/storage/defaultParams.ts`** — 같은 규칙(`기존 + 배당`)을 적용한다:

- 26-27행: `totalReturn: 5, dividendYield: 2.0` → `totalReturn: 7, dividendYield: 2.0`
- 39-40행: `totalReturn: 8, dividendYield: 1.5` → `totalReturn: 9.5, dividendYield: 1.5`
- 55, 63행(사적연금 `totalReturn: 4`): 배당률이 없으므로 **그대로 둔다**

**(b) `src/core/usecases/SimpleSimulationAdapter.ts` 40-70행**:

```ts
        totalReturn = 4.0;   // 예전 1.0 + 배당 3.0
        dividendYield = 3.0; // 이자 수익
```
```ts
        totalReturn = 7.0;   // 예전 3.0 + 배당 4.0
        dividendYield = 4.0;
```
```ts
        totalReturn = 9.5;   // 예전 8.0 + 배당 1.5
        dividendYield = 1.5;
```

**(c) `src/web/features/AssetForm/AssetFormSection.tsx`**:

- 153-155행(실시간 검색 후보의 폴백):

```ts
        totalReturn: rs.type === 'etf' ? 8.5 : 7.0, // 예전 7.0/6.0 + 배당 1.5/1.0
        dividendYield: rs.type === 'etf' ? 1.5 : 1.0,
```

- 349행(신규 자산): `totalReturn: 6, dividendYield: 2` → `totalReturn: 8, dividendYield: 2`
- 493행(신규 ISA): `totalReturn: 5, dividendYield: 1.5` → `totalReturn: 6.5, dividendYield: 1.5`

**(d) 프리셋 상수는 건드리지 않는다.** `applyYieldPreset.ts`의 `YIELD_PRESET_RATES`(5/3, 7/4, 9/6)와 `economicScenarios.ts`의 시나리오 프로필은 주석이 이미 "연 기대수익률"이라고 밝히고 있으므로, `totalReturn`에 대입되는 순간 뜻이 맞는다. 값을 바꾸면 근거 없는 새 가정을 만드는 것이 된다.

- [ ] **Step 8: `stock-info` API가 총수익률을 반환하게 한다**

Modify `src/app/api/stock-info/route.ts`. Task 2의 치환으로 반환 키는 이미 `totalReturn`이지만 값은 아직 가격 CAGR이다. 96-108행을 다음으로 교체한다:

```ts
    // Sanity checks and conservative adjustments
    //
    // **상한을 맨 마지막에 건다.** 예전에는 가격 CAGR에만 걸려 있어 배당이 상한을
    // 우회했다 — 상한 9.5%인데 배당 8%인 종목이 실효 17.5%로 조회되는 식이었다.
    if (isNaN(cagr)) cagr = 6.0; // 데이터 계산 실패 시에만 기본값 사용
    else if (cagr < 0) cagr = 0; // 실시간 조회 값이 마이너스여도 가격 상승률 최소값은 0으로 한다

    if (dividendYield > 30 || dividendYield < 0 || isNaN(dividendYield)) dividendYield = 0;

    // 배당을 포함한 총수익률에 장기 상한을 건다.
    let totalReturn = cagr + dividendYield;
    if (totalReturn > 9.5) totalReturn = 9.5;

    return Response.json({
      ticker,
      totalReturn: Math.round(totalReturn * 10) / 10,
      dividendYield: Math.round(dividendYield * 10) / 10,
    });
```

> 상한을 걸면 `totalReturn < dividendYield`가 되는 종목(JEPI 등)이 생기고 가격상승률이 음수가 된다. 의도된 결과다 — 분배금이 총수익률을 넘는 상품의 NAV 잠식을 그대로 표현한다.

- [ ] **Step 9: 전체 테스트를 돌려 깨진 픽스처의 범위를 확인한다**

```bash
npm test 2>&1 | tail -60
```

Expected: 다수 실패. 배당률이 0이 아닌 픽스처를 쓰는 테스트들이 실효 수익률이 배당만큼 낮아져 기대값과 어긋난다. 실패한 파일 목록을 기록해 둔다.

- [ ] **Step 10: 픽스처를 기계적으로 이관한다**

원칙: **기존 픽스처는 `totalReturn = 기존값 + dividendYield`로 올려 동작을 보존한다.** 이번 작업으로 엔진의 산술은 바뀌지 않고 입력 경계의 매핑만 바뀌므로, 이렇게 옮기면 기존 단언이 그대로 통과하고 그 사실 자체가 "리팩터링이 엔진 동작을 건드리지 않았다"는 증거가 된다.

`src/tests` 안에서 같은 객체 리터럴에 `totalReturn`과 `dividendYield`가 함께 있는 자리를 찾아 손으로 올린다. 자동 치환은 하지 않는다 — 두 필드가 항상 인접해 있지 않고, 배당이 0인 곳은 건드릴 필요가 없다.

대상을 좁히는 명령:

```bash
grep -rn --include='*.ts' --include='*.tsx' 'dividendYield: [1-9]' src/tests | sort
```

각 자리에서 같은 리터럴의 `totalReturn` 값을 `+ dividendYield`만큼 올린다. 예:

```ts
// before
totalReturn: 5, dividendYield: 2,
// after
totalReturn: 7, dividendYield: 2,
```

- [ ] **Step 11: 의미를 검증하던 테스트 3종은 개별로 다시 계산한다**

아래 세 파일은 수익률·배당의 «의미»를 검증하므로 Step 10의 기계적 규칙을 적용하지 않는다. 각각 새 의미에 맞춰 기대값을 다시 세운다.

- `src/tests/core/usecases/SimulationEngine.marketTaxTreatment.test.ts` — 배당세 계산이 배당 흐름의 크기에 의존한다. 배당률을 그대로 두고 `totalReturn`을 조정해 검증 대상(세율·과세 구분)만 남긴다.
- `src/tests/core/usecases/strategy/DividendReinvestmentOptimizer.test.ts` — 재투자 켜기/끄기의 «차이»가 논점이다. 두 후보의 `totalReturn`이 같아야 비교가 성립하므로, 픽스처를 올리되 양쪽에 같은 값을 쓴다.
- `src/tests/core/usecases/montecarlo/volatilityPresets.test.ts` — `marketWeightedStockReturn`이 이제 총수익률을 가중평균한다. 픽스처를 올리면 유도되는 변동성이 달라지므로, 기대 변동성을 새 가중평균으로 다시 계산한다.

Step 9에서 기록한 실패 목록에 위 셋 말고도 값이 아닌 «의미»를 검증하던 테스트가 더 있으면, 기계 규칙을 적용하지 말고 같은 방식으로 개별 판단한다. 기계 규칙을 적용했는데도 깨진다면 그것이 바로 그 신호다.

- [ ] **Step 12: 전체 테스트를 돌린다**

```bash
npx tsc --noEmit
npm test
```

Expected: 전부 통과.

- [ ] **Step 13: 커밋한다**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: 수익률 입력을 총수익률로 해석한다

엔진이 배당을 수익률 «위에» 얹고 있었다. 화면이 7%라고 말한 SCHD는 10%로,
JEPI는 14.9%로, 커버드콜 ISA는 28.2%로 굴렀다. 사적연금은 리포트가 배당률을
출력조차 하지 않아 4%로 표시된 계좌가 실제로는 7~14%였다.

같은 입력으로 두 해석을 비교하면 90세 잔액이 21.3억 대 0원(74세 고갈)으로
갈린다 — 은퇴 가능 판정 자체가 이 차이 위에 서 있었다.

이제 totalReturn이 실효 수익률이고, dividendYield는 그 안에서 현금으로
나오는 몫을 가리킨다. 사적연금은 분해하지 않는다 — 계좌 안에 배당세도
재투자 선택지도 없어 총수익률만이 결과를 결정하고, 성장(기하 복리)과
배당(단리)의 월율 규약이 달라 분해하면 산술까지 바뀐다.

프리셋 종목·기본값의 숫자가 높아진 것은 표기 전환이 아니라 지금까지의 동작을
그대로 옮긴 결과다. stock-info의 9.5% 상한은 이제 배당을 포함한 뒤에 걸린다 —
예전에는 배당이 상한을 우회했다.

기존 픽스처는 totalReturn을 배당만큼 올려 동작을 보존했다. 그 테스트들이
수정 없이 통과한다는 것이 엔진 산술은 건드리지 않았다는 근거다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 입력 화면 — 라벨 통일과 파생값 표시

세 계좌의 수익률 라벨을 "연 총수익률"로 통일하고, 입력칸 아래에 `가격상승 X% + 배당 Y%`를 상시 표시한다. 숫자는 바뀌지 않는다.

**Files:**
- Create: `src/web/features/AssetForm/ReturnBreakdownHint.tsx`
- Create: `src/tests/web/features/AssetForm/ReturnBreakdownHint.test.tsx`
- Modify: `src/web/features/AssetForm/AssetFormSection.tsx` (라벨 6곳, 힌트 삽입 3곳, 조회 3경로)

**Interfaces:**
- Consumes: `priceGrowthRate` (Task 1), `stock-info`의 `{ totalReturn, dividendYield }` (Task 3)
- Produces: `<ReturnBreakdownHint totalReturn={number} dividendYield={number} />`

- [ ] **Step 1: 힌트 컴포넌트의 실패하는 테스트를 작성한다**

Create `src/tests/web/features/AssetForm/ReturnBreakdownHint.test.tsx`:

```tsx
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReturnBreakdownHint } from '@/web/features/AssetForm/ReturnBreakdownHint';

describe('ReturnBreakdownHint', () => {
  test('총수익률을 가격상승분과 배당분으로 나눠 보여준다', () => {
    render(<ReturnBreakdownHint totalReturn={10.5} dividendYield={3.5} />);
    expect(screen.getByText(/가격상승 7%/)).toBeInTheDocument();
    expect(screen.getByText(/배당 3.5%/)).toBeInTheDocument();
  });

  test('가격상승분이 양수면 안내 문구를 띄우지 않는다', () => {
    render(<ReturnBreakdownHint totalReturn={10.5} dividendYield={3.5} />);
    expect(screen.queryByText(/NAV가 줄어드는/)).not.toBeInTheDocument();
  });

  // 커버드콜·고배당 ETF는 분배금이 총수익률을 넘는다. 입력 오류로 오해하지 않도록
  // 그때만 설명을 붙인다.
  test('가격상승분이 음수면 안내 문구를 함께 띄운다', () => {
    render(<ReturnBreakdownHint totalReturn={7} dividendYield={21.2} />);
    expect(screen.getByText(/가격상승 −14.2%/)).toBeInTheDocument();
    expect(screen.getByText(/NAV가 줄어드는/)).toBeInTheDocument();
  });

  test('소수점 반올림 오차를 표시에 흘리지 않는다', () => {
    render(<ReturnBreakdownHint totalReturn={9.4} dividendYield={1.4} />);
    expect(screen.getByText(/가격상승 8%/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/tests/web/features/AssetForm/ReturnBreakdownHint.test.tsx`
Expected: FAIL — `Failed to resolve import "@/web/features/AssetForm/ReturnBreakdownHint"`

- [ ] **Step 3: 힌트 컴포넌트를 구현한다**

Create `src/web/features/AssetForm/ReturnBreakdownHint.tsx`:

```tsx
import React from 'react';
import { priceGrowthRate } from '../../../core/usecases/returns/decomposeReturn';

interface ReturnBreakdownHintProps {
  totalReturn: number;
  dividendYield: number;
}

/**
 * 입력한 총수익률이 엔진 안에서 어떻게 나뉘는지 입력칸 바로 아래에 보여준다.
 *
 * 이 화면이 필요한 이유가 이번 변경의 출발점이다 — 예전에는 화면이 "예상 연 수익률"이라
 * 부르는 값을 엔진이 가격상승률로 읽고 배당을 위에 얹었고, 사용자는 자기 시뮬레이션이
 * 실제로 몇 %로 돌았는지 알 방법이 없었다. 분해를 눈에 보이게 두면 같은 어긋남이
 * 다시 생겨도 즉시 드러난다.
 *
 * 계산은 엔진과 같은 함수(priceGrowthRate)를 쓴다. 여기서 따로 빼면 화면이 말하는
 * 가격상승률과 엔진이 쓰는 값이 갈라진다.
 */
export function ReturnBreakdownHint({ totalReturn, dividendYield }: ReturnBreakdownHintProps) {
  const growth = priceGrowthRate(totalReturn, dividendYield);

  return (
    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', lineHeight: 1.5 }}>
      → 가격상승 {formatPercent(growth)} + 배당 {formatPercent(dividendYield)}
      {growth < 0 && (
        <div style={{ marginTop: '2px' }}>
          ⓘ 분배금이 총수익률보다 커서 NAV가 줄어드는 것으로 계산됩니다.
          커버드콜·고배당 ETF라면 정상입니다.
        </div>
      )}
    </div>
  );
}

/**
 * 부동소수 뺄셈(10.5 − 3.5)이 만드는 꼬리를 화면에 흘리지 않는다. 입력 단위가 0.1%p라
 * 소수 첫째 자리까지만 의미가 있다. 음수는 하이픈이 아니라 −(U+2212)로 적는다 — 좁은
 * 폭에서 하이픈은 글머리표처럼 보인다.
 */
function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded < 0 ? '−' : ''}${Math.abs(rounded)}%`;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/tests/web/features/AssetForm/ReturnBreakdownHint.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: 라벨을 통일하고 힌트를 배치한다**

Modify `src/web/features/AssetForm/AssetFormSection.tsx`. 임포트를 추가한다:

```tsx
import { ReturnBreakdownHint } from './ReturnBreakdownHint';
```

라벨을 바꾼다:

| 위치 | 기존 라벨 | 새 라벨 |
|---|---|---|
| 917행 (일반자산) | `연 성장률` | `연 총수익률` |
| 1314행 (연금 ETF) | `연 주가 상승률` | `연 총수익률` |
| 1363행 (연금 기타) | `investmentType === 'deposit' ? '연 이자율 (금리)' : '연 주가 상승률'` | `investmentType === 'deposit' ? '연 이자율 (금리)' : '연 총수익률'` |
| 1599행 (ISA 기타) | `연 기대 수익률` | `연 총수익률` |
| 939, 1339, 1564, 1608행 (배당) | `연 배당률` / `연 기대 배당률` | 전부 `연 배당률` |

힌트를 세 곳에 넣는다 — 각 계좌의 **배당률 입력칸 바로 아래**(총수익률과 배당률을 둘 다 읽은 뒤여야 하므로):

- 일반자산: 배당률 `priceInputWrapper`(938-955행) 닫는 `</div>` 직후
  ```tsx
  <ReturnBreakdownHint totalReturn={asset.totalReturn} dividendYield={asset.dividendYield} />
  ```
- 사적연금 ETF 분기: 배당률 `priceInputWrapper`(1336-1358행) 닫는 `</div>` 직후
  ```tsx
  <ReturnBreakdownHint totalReturn={pension.totalReturn} dividendYield={pension.dividendYield || 0} />
  ```
- ISA 기타 분기: 배당률 `InputField`(1607-1614행) 직후
  ```tsx
  <ReturnBreakdownHint totalReturn={isa.totalReturn} dividendYield={isa.dividendYield} />
  ```

> 예금형 분기에는 넣지 않는다 — 배당이 없는 계좌에 "배당 0%"를 보여줄 이유가 없다.

- [ ] **Step 6: 자동완성·시세조회 경로를 총수익률로 통일한다**

같은 파일에서, 세 조회 함수가 API의 `totalReturn`을 그대로 쓰게 한다. Task 2 Step 7에서 이미 셰도잉을 정리했으므로 값 매핑만 확인한다 — `fetchAssetInfo`(216-243행), `fetchPensionInfo`(245-272행), `fetchIsaInfo`(274-301행) 모두 `data.totalReturn`과 `data.dividendYield`를 각 계좌의 같은 이름 필드에 넣는다.

자동완성 4곳(603, 611, 1237, 1480행)은 예전에 `Math.round((pa.totalReturn + pa.dividendYield) * 10) / 10`으로 «합»을 계산하고 있었다. 이제 `pa.totalReturn`이 이미 합이므로 **덧셈을 제거한다**:

```tsx
                            totalReturn: pa.totalReturn,
```

일반자산 경로(593-594, 804-805행)는 `totalReturn`과 `dividendYield`를 그대로 넘기므로 변경 없다.

- [ ] **Step 7: 관련 테스트를 돌린다**

```bash
npx vitest run src/tests/web/features/AssetForm
npx tsc --noEmit
```

Expected: PASS. `AssetFormSection.test.tsx`가 라벨 문자열로 입력을 찾고 있다면 새 라벨로 고친다.

- [ ] **Step 8: 커밋한다**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: 입력 화면이 총수익률의 분해를 보여준다

세 계좌가 "연 성장률"·"연 주가 상승률"·"연 기대 수익률"로 제각각 부르던 것을
"연 총수익률"로 통일하고, 입력칸 아래에 가격상승분과 배당분을 상시 표시한다.

사용자가 자기 시뮬레이션이 실제로 몇 %로 도는지 볼 수 없었던 것이 이번 버그가
오래 살아남은 이유다. 분해를 눈에 보이게 두면 같은 어긋남이 다시 생겨도 즉시
드러난다. 계산은 엔진과 같은 함수를 쓴다.

자동완성이 성장률과 배당률을 «더해» 넣던 코드를 지웠다 — 프리셋 값이 이제
합 그 자체라 그대로 넘기면 된다. 시세 조회 3경로가 서로 다른 값을 넣던
불일치도 함께 사라진다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 리포트와 AI 프롬프트

PDF가 실제로 계산에 쓰인 수익률을 그대로 말하게 한다. 사적연금 항목에 빠져 있던 배당률을 추가한다 — 이번 문제가 리포트에서 보이지 않았던 직접적 원인이다.

**Files:**
- Modify: `src/web/features/Pdf/buildReportHtml.ts:389-397`
- Modify: `src/app/api/ai-advisor/route.ts:195, 204`
- Test: `src/tests/web/features/Pdf/` 기존 스냅샷/문자열 테스트

**Interfaces:**
- Consumes: `InvestmentAsset.totalReturn` 등 (Task 2)
- Produces: 없음 (표시 계층 종단)

- [ ] **Step 1: 리포트의 세 계좌 목록 문구를 맞춘다**

Modify `src/web/features/Pdf/buildReportHtml.ts`. `accountListsHtml`(388-400행)의 세 렌더러를 바꾼다.

사적연금 — **배당률 출력을 추가한다**:

```ts
        renderAccountList('사적연금', privatePensions, (p) =>
          `<li style="margin-bottom: 4px;"><strong>${escapeHtml(describePrivatePensionLabel(p))}</strong>: 현재 잔액 ${p.balance.toLocaleString()} ${formatCurrencyUnit(p.currency)}, 매월 ${p.monthlyContribution.toLocaleString()} ${formatCurrencyUnit(p.currency)} 납입, 연 총수익률 ${p.totalReturn}%${p.dividendYield ? ` (배당 ${p.dividendYield}% 포함)` : ''}</li>`,
          '등록된 사적연금 없음'),
```

투자 자산:

```ts
        renderAccountList('투자 자산', assets, (a) =>
          `<li style="margin-bottom: 4px;"><strong>${escapeHtml(describeInvestmentAssetLabel(a))}</strong>: ${a.quantity}주(개) x 평균단가 ${a.averagePrice.toLocaleString()} ${formatCurrencyUnit(a.currency)}, 매월 ${a.monthlyContribution.toLocaleString()} ${formatCurrencyUnit(a.currency)} 납입, 연 총수익률 ${a.totalReturn}% (배당 ${a.dividendYield}% 포함), 배당 재투자 ${a.reinvestDividend ? 'O' : 'X'}</li>`,
          '등록된 투자 자산 없음'),
```

ISA:

```ts
        renderAccountList('ISA 계좌', isaAccounts, (isa) =>
          `<li style="margin-bottom: 4px;"><strong>${escapeHtml(describeIsaAccountLabel(isa))}</strong>: 현재 잔액 ${isa.balance.toLocaleString()} ${formatCurrencyUnit(isa.currency)}, 매월 ${isa.monthlyContribution.toLocaleString()} ${formatCurrencyUnit(isa.currency)} 납입, 연 총수익률 ${isa.totalReturn}% (배당 ${isa.dividendYield}% 포함), 만기 ${isa.maturityYears}년</li>`,
          '등록된 ISA 계좌 없음'),
```

> 사적연금만 `dividendYield`를 조건부로 붙인다. 그 필드가 optional이고 엔진 계산에 쓰이지 않으므로, 값이 없을 때 "배당 0% 포함"이라고 적으면 없는 정보를 지어내는 셈이 된다.

- [ ] **Step 2: AI 프롬프트 문구를 맞춘다**

Modify `src/app/api/ai-advisor/route.ts`.

195행:

```ts
      .map((p) => `${p.name ?? p.type}(잔액 ${toManwon(p.balance)}만, 월 ${toManwon(p.monthlyContribution)}만 납입, 총수익률 ${p.totalReturn}%)`)
```

204행:

```ts
      .map((a) => `${a.name}(${a.type}, 연 총수익률 ${a.totalReturn}%(배당 ${a.dividendYield}% 포함), 월 ${toManwon(a.monthlyContribution)}만 납입)`)
```

- [ ] **Step 3: 리포트 테스트를 돌린다**

```bash
npx vitest run src/tests/web/features/Pdf
```

Expected: PASS. 문자열을 단언하는 테스트가 있으면 새 문구로 고친다.

- [ ] **Step 4: 커밋한다**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: 리포트가 실제 계산에 쓰인 수익률을 말하게 한다

"예상 연 수익률 7%"라고 적힌 자산이 엔진에서는 10%로 굴렀다. 표시와 계산이
같아졌으므로 문구를 총수익률로 맞춘다.

사적연금 항목에는 배당률이 아예 출력되지 않았다. 4%로 표시된 IRP가 실제로는
7~14%였는데 사용자가 그것을 확인할 방법이 리포트 어디에도 없었다 — 이번 문제가
오래 보이지 않은 직접적 원인이다. 세 목록의 형식을 맞춘다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 최종 검증

설계 문서가 예고한 수치가 실제로 나오는지 확인하고, 스펙과 코드가 어긋난 곳이 없는지 마무리한다.

**Files:**
- Create: `src/tests/core/usecases/SimulationEngine.reportScenario.test.ts`
- Modify: `docs/superpowers/specs/2026-08-19-total-return-unification-design.md` (구현 중 달라진 결정이 있으면)

**Interfaces:**
- Consumes: 전체
- Produces: 없음

- [ ] **Step 1: 실제 리포트 시나리오를 고정하는 테스트를 작성한다**

설계 문서의 근거가 된 시나리오(2026-08-19 리포트)를 픽스처로 남긴다. 이 조합이 다시 낙관 쪽으로 새면 즉시 드러난다.

Create `src/tests/core/usecases/SimulationEngine.reportScenario.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import type { SimulationParams } from '@/core/entities/types';

/**
 * 2026-08-19 리포트의 실제 입력. 이 저장소가 총수익률 통일을 하게 만든 시나리오다.
 *
 * 예전 엔진에서는 이 조합이 90세 21.3억으로 "고갈 없음"이었다 — 표시된 7%·4%에
 * 배당이 통째로 더해져 SCHD 10%, JEPI 14.9%, 커버드콜 ISA 28.2%로 굴렀기 때문이다.
 * 표시값을 총수익률로 읽으면 74세에 고갈된다.
 *
 * 숫자를 정확히 고정하지 않고 «고갈이 일어난다»만 고정하는 이유: 세법 프로필이나
 * 지출 곡선 기본값이 바뀌면 잔액은 움직여도 되지만, 이 시나리오가 다시 "평생 유지"로
 * 돌아가는 것은 배당이 어딘가에서 또 더해지고 있다는 뜻이다.
 */
function reportScenario(): SimulationParams {
  const etf = (id: string, ticker: string, quantity: number, averagePrice: number,
               totalReturn: number, dividendYield: number, monthlyContribution: number) => ({
    id, type: 'etf' as const, ticker, name: ticker,
    quantity, averagePrice, totalReturn, dividendYield,
    monthlyContribution, reinvestDividend: true,
    currency: 'KRW' as const, assetMarket: 'US_ETF' as const,
  });

  return {
    userProfile: { currentAge: 51, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
    assets: [
      etf('q', 'QQQ', 9.133318, 986_945, 7, 0.4, 456_250),
      etf('s', 'SCHD', 569.795937, 48_860, 7, 3, 0),
      etf('j', 'JEPI', 117.346339, 82_122, 7, 7.9, 0),
      etf('p', 'SPYM', 15.453288, 129_353, 7, 1, 304_167),
    ],
    isaAccounts: [{
      id: 'isa', type: 'general', investmentType: 'custom',
      balance: 3_772_550, monthlyContribution: 200_000,
      totalReturn: 7, dividendYield: 21.2, currency: 'KRW', maturityYears: 3,
    }],
    // 개시 나이는 NationalPension이 아니라 withdrawalPlan이 갖는다. 미지정이면
    // NATIONAL_PENSION_NORMAL_START_AGE(65세)이며, 리포트가 쓴 값과 같으므로 비워 둔다.
    nationalPension: { expectedMonthlyAmount: 2_000_000 },
    privatePensions: [
      { id: 'p1', type: 'irp', name: 'SOL 미국배당다우존스', balance: 33_868_515,
        monthlyContribution: 350_000, totalReturn: 4, investmentType: 'etf', dividendYield: 3.3, currency: 'KRW' },
      { id: 'p2', type: 'irp', name: 'SOL 미국배당미국채혼합50', balance: 7_040_880,
        monthlyContribution: 150_000, totalReturn: 4, investmentType: 'etf', dividendYield: 3.0, currency: 'KRW' },
      { id: 'p3', type: 'retirement', name: 'TIGER 미국배당다우존스타겟커버드콜2호', balance: 12_145_140,
        monthlyContribution: 500_000, totalReturn: 4, investmentType: 'etf', dividendYield: 10.0, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 2.5,
    inflationMode: 'real',
    baseExchangeRate: 1414.4,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  } as SimulationParams;
}

describe('2026-08-19 리포트 시나리오', () => {
  test('표시값을 총수익률로 읽으면 기대수명 전에 고갈된다', () => {
    const result = new SimulationEngine().run(reportScenario());
    expect(result.depletionAge).not.toBeNull();
    expect(result.depletionAge!).toBeLessThan(90);
  });

  test('사적연금의 배당률은 결과를 바꾸지 않는다', () => {
    const base = reportScenario();
    const withoutPensionDividends: SimulationParams = {
      ...base,
      privatePensions: base.privatePensions.map((p) => ({ ...p, dividendYield: 0 })),
    };
    expect(new SimulationEngine().run(withoutPensionDividends).depletionAge)
      .toBe(new SimulationEngine().run(base).depletionAge);
  });
});
```

- [ ] **Step 2: 테스트를 돌린다**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.reportScenario.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 3: 전체 검증을 돌린다**

```bash
npx tsc --noEmit
npm run lint
npm test
```

Expected: 전부 통과.

- [ ] **Step 4: 옛 키 잔재를 확인한다**

```bash
grep -rn --include='*.ts' --include='*.tsx' -E '\b(annualGrowthRate|annualReturn)\b' src
```

Expected: `migrateLegacyReturnKeys.ts`와 그 테스트에서만 나온다. 다른 곳에 남아 있으면 Task 2의 치환이 놓친 자리다.

- [ ] **Step 5: 스펙과 구현의 차이를 문서에 반영한다**

구현 중 설계와 달라진 결정이 있으면 `docs/superpowers/specs/2026-08-19-total-return-unification-design.md`에 반영한다. 없으면 이 단계를 건너뛴다.

- [ ] **Step 6: 커밋한다**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test: 리포트 시나리오가 다시 낙관으로 새지 않도록 고정한다

총수익률 통일을 하게 만든 실제 입력을 픽스처로 남긴다. 이 조합이 "평생 유지"로
돌아가면 배당이 어딘가에서 또 더해지고 있다는 뜻이다.

잔액을 정확히 고정하지 않고 «고갈이 일어난다»만 고정한다 — 세법 프로필이나
지출 곡선 기본값이 바뀌면 잔액은 움직여도 되지만, 고갈 여부가 뒤집히는 것은
다른 종류의 사건이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 자체 검토 결과

**스펙 커버리지**

| 스펙 절 | 구현 태스크 |
|---|---|
| 1. 도메인 모델 (필드 개명) | Task 2 Step 6–8 |
| 2. 분해 헬퍼 | Task 1 |
| 3. 엔진 (일반자산·ISA 분해, 연금 미분해) | Task 3 Step 3 |
| 4. 저장 데이터 마이그레이션 | Task 2 Step 1–5, Step 9 |
| 4. `deposit` 배당률 0 정규화 | Task 3 Step 4 |
| 5. 입력 기본값·조회값 재보정 | Task 3 Step 6–8 |
| 6. 화면 (라벨·파생값·조회 경로) | Task 4 |
| 7. 리포트·AI 프롬프트 | Task 5 |
| 테스트 1–6 | Task 1 Step 1, Task 2 Step 1, Task 3 Step 1 |
| 픽스처 이관 방침 | Task 3 Step 10–11 |

**미커버 항목:** 없음.

**타입 일관성:** `priceGrowthRate(totalReturnPercent, dividendYieldPercent)`의 시그니처가 Task 1(정의) · Task 3 Step 3(엔진) · Task 4 Step 3(힌트)에서 동일하다. `migrateLegacyReturnKeys(raw: unknown): unknown`이 Task 2 Step 3(정의)과 Step 5(배선)에서 동일하다. `stock-info` 응답 `{ ticker, totalReturn, dividendYield }`가 Task 3 Step 8(생산)과 Task 4 Step 6(소비)에서 일치한다.

**주의:** Task 3은 엔진·값 소스·픽스처가 한 커밋에 묶여 diff가 크다. 나눌 수 없는 이유는 어느 하나만 먼저 바꾸면 표시값과 계산값이 어긋난 상태가 커밋으로 남기 때문이다. 대신 Task 2에서 기계적 개명을 미리 떼어내 "이름만 바뀐 큰 diff"와 "뜻이 바뀐 작은 diff"를 따로 리뷰할 수 있게 했다.

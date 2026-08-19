# 수익률 입력을 총수익률(Total Return) 방식으로 통일

작성일: 2026-08-19

## 배경

계산 엔진과 화면이 같은 필드를 서로 다른 뜻으로 읽고 있다.

`SimulationEngine.initializeAssets`는 `InvestmentAsset.annualGrowthRate`를 **가격상승률**로
취급하고, 그 위에 `dividendYield`를 따로 얹는다(`SimulationEngine.ts:425-429`). 즉 엔진의
실효 수익률은 `annualGrowthRate + dividendYield`다. 사적연금은 `investmentType === 'etf'`일 때
같은 덧셈을 하고(`SimulationEngine.ts:456-458`), ISA는 유형과 무관하게 항상 더한다
(`SimulationEngine.ts:473-477`).

그런데 화면과 리포트는 그 필드를 **"예상 연 수익률"**이라고 부른다
(`buildReportHtml.ts:393`, `AssetFormSection.tsx:1599`). 사용자는 총수익률을 입력했다고
믿지만 엔진은 거기에 배당을 한 번 더 얹는다.

실측(`NextLife_Simulation_Report (5).pdf`, 2026-08-19 출력)에서 이 차이가 만든 결과:

| 계좌 | 리포트 표시 | 엔진 실효 (명목) |
|---|---:|---:|
| QQQ | 7% (배당 0.4%) | 7.4% |
| SCHD | 7% (배당 3%) | 10.0% |
| JEPI | 7% (배당 7.9%) | 14.9% |
| SPYM | 7% (배당 1%) | 8.0% |
| ISA (커버드콜) | 7% (배당 21.2%) | 28.2% |
| 사적연금 3종 | 4% | 7.0 ~ 14.0% |

사적연금은 리포트가 배당률을 아예 출력하지 않아(`buildReportHtml.ts:389`) 사용자가 확인할
방법조차 없었다. 같은 입력으로 엔진을 돌려 두 해석을 비교하면:

| 해석 | 60세 자산 | 90세 자산 | 고갈 |
|---|---:|---:|---|
| 현재 동작 (표시값 = 가격상승률) | 4.90억 | 21.3억 | 없음 |
| 표시값 = 총수익률 | 3.41억 | 0원 | **74세** |

"60세 은퇴 가능"이라는 판정 전체가 이 차이 위에 서 있다.

같은 뿌리에서 세 가지 결함이 함께 나왔다.

- **MC 변동성 과소설정**: `marketWeightedStockReturn`이 `annualGrowthRate`(배당 제외)만
  잔액가중한다(`volatilityPresets.ts:110-113`). 위 포트폴리오는 전부 7%로 입력돼 15%p가
  나왔지만, 실효 총수익률로 가중하면 약 11.7% → 같은 함수가 20%p를 낸다.
- **충격이 배당을 비켜간다**: `applyReturnShock`이 `growthRateMonthly`만 조정한다
  (`SimulationEngine.ts:340-343`). -2%p 시나리오에서 JEPI는 14.9% → 12.9%로만 떨어지고
  배당 7.9%p는 하락장에도 그대로 나온다.
- **ISA `deposit` 배당 누수**: 엔진이 `investmentType`과 무관하게 `divRateMonthly`를 계산하는데
  (`SimulationEngine.ts:477`), UI는 `deposit`을 고르면 배당 입력칸을 숨기고
  (`AssetFormSection.tsx:1586`) 신규 ISA의 기본 `dividendYield`는 1.5다
  (`AssetFormSection.tsx:493`). 예금형을 골라도 연 1.5%가 조용히 더 붙는다.

세 결함 모두 "같은 필드를 두 뜻으로 읽는다"의 파생이므로, 필드의 뜻을 하나로 고정하면
별도 수정 없이 함께 닫힌다.

또 하나: 같은 개념에 대한 계약이 경로마다 다르다.

| 경로 | `annualReturn`에 넣는 값 |
|---|---|
| 자동완성 선택 (`AssetFormSection.tsx:603, 611, 1237, 1480`) | 성장률 + 배당률 |
| 시세 조회 (`AssetFormSection.tsx:260, 289`) | 성장률만 |
| 타입 주석 (`types.ts:65`) | "ETF인 경우 연 성장률로 사용" |

## 목표

- 세 계좌 유형(일반자산·사적연금·ISA)의 수익률 필드가 **배당을 포함한 연 총수익률** 하나의
  뜻만 갖는다.
- 가격상승률과 배당분의 분해는 **엔진 안에서 공유 함수 하나**로만 일어난다.
- 저장된 시나리오는 그대로 열린다. 값 변환 없이 키만 옮기므로 마이그레이션은 멱등이다.
- 화면·PDF가 실제로 계산에 쓰인 수익률을 그대로 보여준다.

## 비목표

- **수익률 가정값 자체의 재검토.** 프리셋 5/7/9·3/4/6, `predefinedAssets`의 개별 종목 값은
  원 의도를 보존해 옮기기만 한다. AGENTS.md의 "임의의 금융 제도, 세율 또는 수익률 가정을
  새로 만들지 않는다"를 따른다.
- **배당의 변동성 모델링.** 총수익률로 통일해도 하락장에서 배당이 먼저 줄어드는 현실은
  반영되지 않는다(충격은 여전히 가격상승분에만 걸린다 — 다만 그 결과 총수익률이 충격만큼
  움직이므로 지금의 결함은 사라진다). 배당 자체에 변동성을 주는 것은 별도 과제다.
- 수익률과 무관한 리팩터링.

## 호환성 결정

**저장된 시나리오의 계산 결과는 바뀐다.** 저장된 숫자(예: 7)를 총수익률로 재해석하므로,
배당률이 0이 아닌 시나리오는 실효 수익률이 배당만큼 낮아진다. 이는 의도된 정정이다 —
사용자가 화면에서 본 숫자가 실제 계산값이 되는 방향이다.

값을 변환하지 않으므로(`annualGrowthRate: 7` → `totalReturn: 7`) 마이그레이션에 버전 마커가
필요 없고, 여러 번 적용해도 같은 결과가 나온다.

## 변경 설계

### 1. 도메인 모델

| 파일 | 변경 |
|---|---|
| `core/entities/types.ts` | `InvestmentAsset.annualGrowthRate` → `totalReturn`, `PrivatePension.annualReturn` → `totalReturn`, `IsaAccount.annualReturn` → `totalReturn`. 주석을 "배당을 포함한 연 총수익률 %"로 고친다. `dividendYield` 주석은 "총수익률 중 현금으로 분배되는 비율 %"로 고치고, `PrivatePension.dividendYield`에는 **엔진 계산에 쓰이지 않는 표시 전용 값**임을 명시한다(3절) |
| `core/domain/input/retirement.ts` | `AccountProjection`(3종)의 `annualReturn` → `totalReturn` |
| `core/domain/input/RetirementModelAdapter.ts` | `fromLegacy`/`toLegacy` 양방향 매핑의 키 이름. 왕복이 대칭이므로 기계적 치환 |

`CustomYieldSnapshot`(`types.ts:247-249`)은 값이 숫자 맵이라 키 이름만 유지하고 뜻만
재해석된다. 구조 변경 없음.

### 2. 분해 헬퍼 (신규)

`core/usecases/returns/decomposeReturn.ts`

```ts
/**
 * 총수익률에서 배당분을 뺀 가격상승률(%).
 *
 * 배당률이 총수익률보다 크면 음수가 된다 — 커버드콜·고배당 ETF에서 정상이다.
 * 분배금이 총수익률을 넘는 만큼 NAV가 줄어드는 상품이 실제로 존재하므로 0으로 자르지 않는다.
 */
export function priceGrowthRate(totalReturnPercent: number, dividendYieldPercent: number): number;
```

**이 함수가 총수익률을 분해하는 유일한 자리다.** `SimulationEngine.initializeAssets`에서
일반자산과 ISA가 이 함수를 거친다(사적연금은 분해하지 않는다 — 3절). 화면의 파생값 표시(6절)도
같은 함수를 쓴다.

### 3. 엔진

`core/usecases/SimulationEngine.ts` `initializeAssets`(419-487행):

| 계좌 | 지금 | 변경 후 |
|---|---|---|
| 일반자산 | `growthRateAnnual = annualGrowthRate`, 배당 별도 가산 | `growthRateAnnual = priceGrowthRate(totalReturn, dividendYield)` |
| ISA | `returnRateAnnual = annualReturn`, 배당 별도 가산 | `returnRateAnnual = priceGrowthRate(totalReturn, dividendYield)` |
| 사적연금 | `totalReturnAnnual = annualReturn + (etf면 dividendYield)` | `returnRateAnnual = totalReturn` (**분해하지 않는다**) |

- `investmentType === 'etf'` 가드(456-458행)를 삭제한다.
- `inflationMode === 'real'`의 물가 차감은 지금처럼 **가격상승분에만** 적용한다. 배당은
  실질 잔액에 대한 수익률이므로 이중 차감이 되지 않는다(현재 동작과 동일).

**사적연금을 분해하지 않는 이유.** 엔진의 두 월율 변환 규약이 다르다 — 성장률은 기하
복리(`toMonthlyCompoundRate`, `SimulationEngine.ts:62-64`)이고 배당은 단리(`/12`)다. 따라서
`분해(total−div 기하) + 배당(div 단리) ≠ 미분해(total 기하)`이며, 사적연금을 분해하면 의도한
의미 변경을 넘어 월율 산술까지 조용히 달라진다.

분해할 이유도 없다. 사적연금 계좌 안에서는 배당세가 없고, 재투자 선택지도 없으며, 배당이
잔액에 그대로 쌓인다. 즉 **총수익률만이 결과에 영향을 준다.** `PrivatePension.dividendYield`는
표시(6·7절의 파생값·리포트)와 시세 조회 일관성을 위해 남기되, **엔진 계산에는 쓰이지 않는다**는
것을 타입 주석에 명시한다.

일반자산·ISA의 기하/단리 혼용은 이 작업 이전부터 있던 규약이고 그대로 둔다. 이번 변경은
`totalReturn`을 어떻게 나누느냐만 바꾸며, 나눈 뒤의 월율 계산은 건드리지 않는다.

**변경이 필요 없는 곳** — 같은 필드를 읽으므로 자동으로 정정된다:

- `applyReturnShock`(340-352행): 가격상승분에 ±%p를 더하면 총수익률이 그만큼 움직인다.
- `montecarlo/volatilityPresets.ts` `marketWeightedStockReturn`: 필드명만 바꾸면 총수익률
  기준 가중평균이 된다.
- `scenario/applyYieldPreset.ts`, `scenario/economicScenarios.ts`: 상수 5/7/9·3/4/6이 주석대로
  "연 기대수익률"이므로 `totalReturn`에 대입하는 순간 뜻이 맞는다. **값은 바꾸지 않는다.**
- `dashboard/computeSensitivityAnalysis.ts:37-39`: `+delta`를 총수익률에 걸게 되어 민감도
  시나리오가 배당까지 포함해 움직인다.

### 4. 저장 데이터 마이그레이션

`infrastructure/storage/normalizeSimulationParams.ts` 한 곳에서만 처리한다. 이 파일이 모든
로드 경로(`useScenarios.ts:107, 1346`)를 지나는 유일한 정규화 레이어다.

```
totalReturn 키가 있으면            → finite(raw.totalReturn, 0)
없고 annualGrowthRate/annualReturn → 그 숫자를 값 변환 없이 totalReturn으로
둘 다 없으면                       → 0  (기존 finite(_, 0) 규약 유지)
```

- 값을 더하지 않으므로 **멱등**이다. 두 번 적용해도 같은 값이 나온다.
- 저장할 때는 신규 키만 쓴다. 옛 키를 함께 쓰지 않는다(단방향).
- `investmentType === 'deposit'`인 사적연금·ISA는 `dividendYield`를 0으로 정규화한다.
  UI가 숨기는 필드에 값이 남아 있으면 안 된다. 이것으로 ISA `deposit` 누수가 닫힌다.
- `infrastructure/storage/normalizationIssues.ts:44`의 필드 화이트리스트에 `totalReturn`을
  추가하고 옛 키는 남긴다(옛 시나리오의 이슈 리포트가 계속 동작해야 하므로).

### 5. 입력 기본값·조회값 재보정

의미가 바뀌었으므로 **원 의도를 보존하려면 값도 함께 옮겨야 하는** 곳들이다.

| 파일 | 변환 |
|---|---|
| `web/features/AssetForm/predefinedAssets.ts` | 34종 중 배당률이 0이 아닌 17종. `{annualGrowthRate: g, dividendYield: d}` → `{totalReturn: g + d, dividendYield: d}`. 예: SCHD `{7.0, 3.5}` → `{10.5, 3.5}`, JEPI `{5.0, 8.0}` → `{13.0, 8.0}`, TLT `{3.5, 4.0}` → `{7.5, 4.0}` |
| `infrastructure/storage/defaultParams.ts` | `{5, 2.0}` → `{7, 2.0}`, `{8, 1.5}` → `{9.5, 1.5}` |
| `core/usecases/SimpleSimulationAdapter.ts:40-70` | 하드코딩 3종 동일 변환 (`{1.0, 3.0}` → `{4.0, 3.0}` 등) |
| `app/api/stock-info/route.ts` | `totalReturn = 가격 CAGR + 배당률`을 반환한다. **9.5% 상한을 총수익률에 건다** — 주석의 "일반 자산의 장기 CAGR 상한"이 총수익률을 뜻하는 것으로 읽는다. 결과적으로 지금(최대 9.5 + 배당)보다 보수적이다 |

`stock-info`의 클램프 순서를 명시한다(현재 97-102행의 순서가 바뀌므로):

1. 가격 CAGR의 기존 정제를 먼저 한다 — `NaN → 6.0`, `음수 → 0`. 이 규칙은 그대로 둔다.
2. 배당률의 기존 정제를 한다 — `>30 또는 음수 또는 NaN → 0`.
3. `totalReturn = cagr + dividendYield`를 구한다.
4. **마지막에** `totalReturn > 9.5 → 9.5` 상한을 건다.

상한을 마지막에 거는 것이 요점이다. 지금은 가격 CAGR에만 걸려 있어 배당이 상한을 우회했다.

`predefinedAssets`의 변환은 지금까지 실제로 그 값으로 계산돼 왔다는 사실을 드러낼 뿐,
동작을 바꾸지 않는다. 값의 타당성(JEPI 13%가 적정한가)은 이 작업의 범위 밖이다.

### 6. 화면

`web/features/AssetForm/AssetFormSection.tsx`

- 라벨 통일: "연 성장률"(917행) / "연 주가 상승률"(1314, 1363행) / "연 기대 수익률"(1599행)
  → **"연 총수익률"**. 배당 라벨은 "연 배당률"로 통일한다.
- 입력칸 아래 파생값을 상시 표시한다: `→ 가격상승 X% + 배당 Y%`.
- 파생 가격상승률이 음수면 안내를 덧붙인다:
  > 분배금이 총수익률보다 커서 NAV가 줄어드는 것으로 계산됩니다. 커버드콜·고배당 ETF라면 정상입니다.
- `fetchAssetInfo` / `fetchPensionInfo` / `fetchIsaInfo`(216-300행)가 모두 API의 `totalReturn`과
  `dividendYield`를 그대로 넣는다. 자동완성 3경로(603, 611, 1237, 1480행)도 `totalReturn`에
  넣는다. **경로별 계약 불일치가 이것으로 해소된다.**

파생값 표시는 세 계좌 유형이 같은 컴포넌트를 쓴다(신규 소형 컴포넌트 1개). 라벨과 계산이
계좌마다 갈라지지 않게 한다.

### 7. 리포트

`web/features/Pdf/buildReportHtml.ts`

- 투자 자산(393행): `예상 연 수익률 N%, 배당률 M%` → `연 총수익률 N% (배당 M% 포함)`
- ISA(396행): 동일
- **사적연금(389행): 배당률 출력을 추가한다.** 지금 없어서 이번 문제가 리포트에서 보이지
  않았다. `연 총수익률 N% (배당 M% 포함)` 형식으로 세 목록을 맞춘다.
- `app/api/ai-advisor/route.ts:195, 204`의 프롬프트 문구도 총수익률로 고친다.

## 테스트

### 신규

1. **`priceGrowthRate` 단위 테스트** — 배당 < 총수익률, 배당 = 총수익률(0), 배당 > 총수익률(음수).
2. **회귀**: 총수익률 7%·배당 3% 자산의 1년 후 잔액이 총수익률 7%·배당 0% 자산과 같다.
   배당이 총수익률 위에 더해지지 않는다는 이번 버그의 직접 회귀 테스트.
3. **회귀**: `investmentType: 'etf'`인 사적연금에서 `dividendYield`가 결과에 전혀 영향을 주지
   않는다(0일 때와 10일 때의 잔액이 같다). 지금은 총수익률에 더해진다.
4. **회귀**: `investmentType: 'deposit'`인 ISA에서 `dividendYield`가 총합에 영향을 주지 않는다.
5. **마이그레이션**: 옛 키(`annualGrowthRate`/`annualReturn`)만 있는 JSON이 값 변환 없이
   `totalReturn`으로 읽힌다. 두 번 적용해도 같다(멱등).
6. **`deposit` 정규화**: `investmentType: 'deposit'`이면 `dividendYield`가 0이 된다.

### 기존 픽스처 이관 방침

배당률이 0이 아닌 픽스처가 **52개 테스트 파일**에 있다. 개명만 하면 실효 수익률이 배당만큼
떨어져 다수의 기대값이 깨진다.

**기존 픽스처는 `totalReturn = 기존값 + dividendYield`로 올려 동작을 보존한다.**

이번 작업으로 엔진의 산술(가격상승 + 배당의 월복리)은 바뀌지 않는다. 바뀌는 것은 *입력
경계의 매핑*뿐이다. 픽스처를 이렇게 옮기면 기존 단언이 그대로 통과하고, 그 사실 자체가
"리팩터링이 엔진 동작을 건드리지 않았다"는 증거가 된다. 의미 변경은 신규 회귀 테스트와
프로덕션 기본값(5절)에만 나타난다.

예외: 수익률·배당 의미 자체를 검증하는 테스트
(`SimulationEngine.marketTaxTreatment`, `strategy/DividendReinvestmentOptimizer`,
`montecarlo/volatilityPresets`)는 값을 올리지 않고 새 의미에 맞춰 기대값을 다시 계산한다.
각 갱신은 개별로 확인한다 — 일괄 치환하지 않는다.

## 구현 순서

1. `priceGrowthRate` 헬퍼 + 단위 테스트, 회귀 테스트 2~4번 작성 (실패 확인)
2. 타입 개명 + 엔진 분해 → 회귀 테스트 통과
3. 정규화/마이그레이션 + 테스트 5~6번
4. 프리셋·기본값·`stock-info` 값 재보정
5. UI 라벨 + 파생값 표시 컴포넌트
6. 리포트·AI 프롬프트 문구
7. 52개 픽스처 일괄 이관 + 전체 테스트

## 위험과 대응

| 위험 | 대응 |
|---|---|
| 픽스처 이관 중 "동작 보존"과 "의미 정정"을 섞어 기대값을 잘못 갱신 | 이관은 `+= dividendYield` 기계적 규칙만 적용한다. 그래도 깨지는 테스트는 개별 조사한다 — 깨졌다는 것 자체가 그 테스트가 의미를 검증하고 있었다는 신호다 |
| 232곳 치환 중 누락 | 타입에서 옛 이름을 **완전히 제거**한다. 누락은 컴파일 오류로 드러난다 |
| 사용자가 아무것도 안 바꿨는데 결과가 나빠짐 | 의도된 정정이다. 화면이 실제 계산값을 보여주게 되는 것이 목적이다 |
| 커버드콜 ETF의 음수 가격상승률이 입력 오류로 오해됨 | 파생값과 안내 문구를 입력칸 바로 아래 상시 표시한다(6절) |

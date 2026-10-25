# 수익률 가정 축을 계획에서 분리한다

작성일: 2026-08-22

## 배경

「리스크 성향」과 「경제 시나리오」는 사용자의 *가정*인데, 지금은 그 가정이 사용자가 입력한
자산을 **덮어쓴다.**

실측(2026-08-22, 실제 사용자 시나리오 `20260815_2026-08-22.json`). 저장된
`strategy.riskProfile: 'conservative'` 하나가 8개 계좌의 총수익률을 전부 갈아치웠다.

| 계좌 | 입력·저장값 | 엔진이 쓴 값 | 배당률 | 실효 가격상승률 |
|---|---:|---:|---:|---:|
| QQQ | 9.5% | **5%** | 0.4% | 4.6% |
| SCHD | 7% | **5%** | 3% | 2.0% |
| JEPI | 0% | **5%** | 7.9% | −2.9% |
| SPYM | 9.5% | **5%** | 1% | 4.0% |
| SOL 미국배당다우존스 | 9.5% | **3%** | 2.9% | — |
| SOL 미국채혼합50 | 6.4% | **3%** | 2.9% | — |
| TIGER 커버드콜2호 | 3.5% | **3%** | 9.6% | — |
| ISA (KODEX 커버드콜) | 0% | **5%** | 21.2% | **−16.2%** |

그 결과가 리포트 전체를 만들었다.

| 리스크 성향 | 60세 자산 | 고갈 | 90세 잔여 | 지속가능 | 결손 연수 | MC 자산생존 | MC 목표달성 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 안정형(현재) | 2.87억 | **83세** | 0 | 227만 | 16년 | 15.9% | 0.0% |
| 입력값 유지 | 3.70억 | **없음** | 2.20억 | 312만 | 0년 | 40.7% | 40.7% |

**종목을 무엇으로 담아도 결과가 같은 상태였다.** 서비스는 2단계에서 자산·투자 현황을
입력받는데, 그 입력이 계산에 닿지 않는다.

같은 뿌리에서 결함이 다섯 개 더 나왔다.

- **두 축이 수익률에서 겹친다.** `applyEconomicScenario`가 물가·환율에 더해 주식·연금·ISA
  수익률까지 덮는다(`economicScenarios.ts:85-105`). `compileStrategy`는 경제 시나리오를 먼저,
  리스크 성향을 나중에 적용하므로(`compileStrategy.ts:445-447`) 수익률은 언제나 리스크 성향이
  이긴다 — 경제 시나리오의 `stockGrowthRate`는 두 축이 모두 지배할 때 **아무 효과가 없다.**
- **잠긴 입력칸이 엔진이 쓰지 않는 숫자를 보여준다.** 프리셋이 지배하면 폼은 수익률 입력을
  비활성화하지만(`AssetFormSection.tsx:914`), 표시값은 `asset.totalReturn` 곧 저장값이다.
  JEPI 칸에는 0%, QQQ 칸에는 9.5%가 보이고 엔진이 쓰는 5%는 화면 어디에도 없다.
- **분해 힌트가 틀린 값으로 안심시킨다.** `ReturnBreakdownHint`도 저장값으로 계산해
  「가격상승 −7.9%」를 띄우지만 실제는 −2.9%다. 그 아래 문구는
  「커버드콜·고배당 ETF라면 정상입니다」인데, 커버드콜을 보고 있는 사용자에게 이 문장은
  「이상 없음」으로 읽힌다.
- **총수익률은 잠기는데 배당률은 안 잠긴다.** 엔진이 `가격상승 = 총수익 − 배당`으로 나누므로
  잠기지 않은 칸이 잠긴 값의 효과를 바꾼다. 위 표의 ISA가 그 상태다(5% − 21.2% = −16.2%).
- **σ가 옛 프리셋에 굳는다.** `resolveMonteCarloConfig`가 `params.yieldPreset`을 먼저 읽는데
  (`volatilityPresets.ts:85-105`), 리스크 성향을 「입력 수익률 유지」로 바꿔도 UI는
  `strategy.riskProfile`만 고치고 `yieldPreset`은 그대로 둔다
  (`InvestmentStrategySection.tsx:33`). 수익률은 사용자 값(가중평균 7.6%)인데 변동성만
  안정형 10%p로 남는다 — 유도값은 16%p대다.

그리고 추천 엔진이 이 덮어쓰기를 **조언으로 내보낸다.** `StrategyGenerator`의
「자산배분」 후보 축(`CONSERVATIVE`/`BALANCED`/`GROWTH`)은 yieldPreset을 갈아끼우는 것만으로
구현되어 있다(`StrategyGenerator.ts:314-320`). 「성장형으로 바꾸세요」는 실질적으로
**「수익률을 9%라고 가정하세요」**이고, 당연히 점수가 오른다. 조언이 아니라 가정 변경이다.

`robustness.ts`는 이미 옳은 원칙을 적어 두었다.

> 리스크 성향과 경제 시나리오는 사용자의 *가정*이다. (…) 사용자가 입력한 물가·수익률은 절대
> 덮어쓰지 않고, 화면에 그려지는 곡선도 사용자 가정 그대로다. 바뀌는 것은 "어느 인출 계획을
> 추천하는가"뿐이다.

그 원칙이 `'ai_*'` 경로에만 적용되고, 사용자가 명시적으로 프리셋을 고르면 버려진다.
이 작업은 원칙을 **모든 경로로 넓힌다.**

## 목표

- 수익률의 유일한 출처는 **사용자 입력**이다. 어떤 축도 그것을 덮어쓰지 않는다.
- 프리셋은 두 가지로만 남는다 — **입력칸을 채워 주는 도우미**와 **민감도·강건성 렌즈**.
- 「리스크 성향」과 「경제 시나리오」가 수익률에서 겹치지 않는다.
- 화면이 보여주는 수익률 = 엔진이 쓰는 수익률.

## 비목표

- **프리셋 수치의 재검토.** 5/7/9%와 3/4/6%, 경제 국면의 물가·환율 값은 원 의도를 보존해
  옮기기만 한다. AGENTS.md의 「임의의 금융 제도, 세율 또는 수익률 가정을 새로 만들지 않는다」.
- **진짜 자산배분 모델 도입.** 「주식·채권 비중」 같은 모델은 별도 과제다. 이번에는 가짜
  자산배분 축을 걷어내기만 한다.
- **JEPI·ISA의 `totalReturn: 0` 자체를 고치는 것.** 그것은 사용자의 입력값이며, 이 변경으로
  비로소 계산에 «닿게» 된다. 값의 타당성은 사용자가 판단한다(아래 위험 참조).
- 수익률과 무관한 리팩터링.

## 호환성 결정

**저장된 시나리오의 계산 결과는 바뀐다. 조용히 적용한다.**

프리셋이 지배하던 시나리오는 이제 자산별 입력값으로 계산된다. 이것은 파괴가 아니라
**복원**이다 — `applyYieldPreset`은 계산용 params에만 적용되고 저장소를 건드리지 않으므로,
사용자가 입력한 값은 지금도 저장 파일에 그대로 살아 있다. 위 실측 시나리오의 저장값이
9.5·7·0·9.5인 것이 그 증거다.

즉 「화면이 보여주던 값이 실제 계산값이 된다」 — 총수익률 통일(2026-08-19)과 같은 방향의
정정이며, 같은 이유로 별도 안내를 두지 않는다.

**마이그레이션은 유니온을 줄이는 것으로 끝난다.** `asOneOf`는 목록에 없는 문자열에
`undefined`를 돌려주고(`normalizeSimulationParams.ts:472-473`) `pickValid`가 그 키를
떨어뜨리므로, 저장된 `riskProfile: 'conservative'`는 키가 사라진 채 `resolveStrategy`에
도달해 기본값 `'ai_recommended'`로 메워진다. 값 변환이 없으므로 멱등이고 버전 마커가 필요 없다.

## 변경 설계

### 1. 경제 시나리오에서 수익률을 뗀다

`core/usecases/scenario/economicScenarios.ts`

`EconomicScenarioProfile`에서 `stockGrowthRate`와 `pensionReturnRate` **필드 자체를 지운다.**
남는 것은 `inflationRate`와 `exchangeScenario`다.

```ts
export interface EconomicScenarioProfile {
  inflationRate: number;
  exchangeScenario: SimulationParams['exchangeScenario'];
}
```

`applyEconomicScenario`는 `assets`·`privatePensions`·`isaAccounts`를 더 이상 손대지 않는다.
타입에서 지우면 누락이 컴파일 오류로 드러난다 — 총수익률 통일에서 옛 키를 완전히 제거해
232곳 치환의 누락을 컴파일러에 맡긴 것과 같은 수법이다.

`ECONOMIC_SCENARIO_PROFILES`의 물가·환율 값은 **그대로 둔다.**

### 2. 리스크 성향에서 지배하는 값을 없앤다

| 파일 | 변경 |
|---|---|
| `core/entities/types.ts:780` | `RiskProfile`에서 `'conservative' \| 'neutral' \| 'aggressive'` 제거. 남는 값은 `'custom' \| 'ai_recommended'` |
| `core/usecases/strategy/compileStrategy.ts` | `RISK_PROFILE_PRESETS`·`GoverningRiskProfile`·`isGoverningRiskProfile`·`resolveRiskProfileYieldPreset` 제거, 445-447행의 `applyYieldPreset` 호출 제거 |
| `infrastructure/storage/normalizeSimulationParams.ts:244` | `RISK_PROFILES`에서 세 값 제거 (`coversUnion`이 타입과 목록의 일치를 강제하므로 자동으로 따라온다) |

`RISK_PROFILE_LABELS`에서도 세 항목을 지운다. 남는 둘의 차이는 이제 **강건성 검증 on/off**
하나로 정리된다 — `'ai_recommended'`는 여러 국면에서 견디는 인출 계획을 고르고,
`'custom'`은 사용자 가정 하나로만 평가한다. 둘 다 수익률은 입력값 그대로다.

### 3. `applyYieldPreset`은 남기되 호출부를 옮긴다

함수 자체는 바꾸지 않는다. `compileStrategy`에서의 호출만 없애고, 남는 호출부는 셋이다.

1. **입력 도우미** (신규, 6절) — 저장 params에 적용
2. **강건성 변이** (`strategy/robustness.ts`) — 이미 그렇게 쓰고 있다
3. **민감도 시나리오** (신규, 5절)

`restoreCustomYieldPreset`은 지금 호출부가 없는 죽은 코드이고, 주석이
「customYieldSnapshot을 되돌릴 UI가 다시 생기면 그대로 쓸 수 있도록 남겨 둔다」고 적어 두었다.
6절의 도우미가 그 UI다.

### 4. 변동성을 언제나 유도한다

`core/usecases/montecarlo/volatilityPresets.ts`

`resolveMonteCarloConfig`에서 `params.yieldPreset` 분기를 제거하고 언제나
`derivedVolatility(params)`를 쓴다. 프리셋이 수익률을 지배하지 않게 되었으므로 「프리셋을
고른 경우는 유도해도 같은 값이 나온다」는 전제가 더 이상 성립하지 않는다 — 이제 그 분기는
**옛 프리셋 값에 σ를 묶어 두는 일만** 한다.

`params.yieldPreset` 필드는 남긴다. 도우미가 마지막으로 채운 프리셋의 표식이자
`customYieldSnapshot` 되돌리기의 기준이다(계산에는 쓰이지 않는다는 것을 타입 주석에 명시한다).

### 5. 민감도 표: 수익률 ±2%p를 프리셋 3행으로 교체

`core/usecases/dashboard/computeSensitivityAnalysis.ts:79-86`

`returnDown`/`returnUp` 두 행을 걷어내고 세 행을 넣는다.

```
안정형 가정 (주식 5% / 연금 3%)
중립형 가정 (주식 7% / 연금 4%)
공격형 가정 (주식 9% / 연금 6%)
```

각 행은 `mapFrozenPlan(frozen, (p) => applyYieldPreset(p, preset))`으로 만든다. 표는 6행에서
7행이 된다.

**교체하는 이유.** 실측 시나리오의 가중평균 총수익률은 7.6%라 ±2%p는 5.6%/9.6%가 되어
프리셋과 사실상 같은 자리를 잰다. 절대 앵커 쪽이 「내 가정이 시장 통념 대비 어디쯤인가」를
답하므로 목표 기반 흐름에 맞는다.

몬테카를로의 σ와는 겹치지 않는다 — σ는 「기대는 맞지만 해마다 흔들린다면」이고, 프리셋 행은
「기대 자체가 다르다면」이다. 두 질문은 다르다.

### 6. 입력 도우미 (신규)

`web/features/AssetForm/AssetFormSection.tsx`

자산 목록 위에 버튼 세 개를 둔다: **「수익률 일괄 채우기 — 보수적 5% · 중립 7% · 공격 9%」**.

- 누르면 `applyYieldPreset(params, preset)`을 **저장 params**에 적용한다. 값이 입력칸에 실제로
  찍히고, 사용자가 보고 개별로 고칠 수 있다.
- 직전 상태는 `customYieldSnapshot`에 담기므로 `restoreCustomYieldPreset`으로 되돌린다.
  「직접 입력값으로 되돌리기」 버튼을 스냅샷이 있을 때만 노출한다.
- 사적연금은 3/4/6%로, ISA는 주식과 같은 값으로 채운다(`applyYieldPreset`의 기존 규약).

**잠금이 사라진다.** `yieldGovernedBy`가 언제나 null이 되므로 수익률·배당률 입력칸과 시세
조회 버튼의 `disabled`가 전부 풀리고, 651행의 안내 배너도 없어진다. 배경에 적은 결함 셋(잠긴
칸의 stale 표시, 분해 힌트의 틀린 값, 배당률만 안 잠기는 비대칭)이 이것으로 함께 닫힌다.

### 7. 자산배분 추천 축 제거

| 파일 | 변경 |
|---|---|
| `core/strategy/StrategyGenerator.ts` | `AssetAllocationPreset` 타입, `StrategyDimensions.assetAllocation`, `allocations` 후보 목록(314-320행), 347행 루프, 391·394행의 개수 집계, `baselineDimensions`의 `assetAllocation` 유도(223-225행)에서 제거. 180행의 `yieldPreset` 주입도 함께 없앤다 |
| `core/usecases/dashboard/strategyFieldMap.ts` | `withdrawalPolicy` 아래의 자산배분 축(267-284행)과 `candidatePreset`(333행) 제거 |

후보 수가 1/3로 준다(최대 218 → 73). 「자산배분을 바꾸라」는 추천이 사라지는 것이 이 변경의
요점이다 — 그 추천은 인출 계획을 바꾸지 않고 **가정만 바꾼다.**

### 8. 문구

- **경제 시나리오 카드** (`StrategySettings/strategyOptions.tsx`): 이제 물가·환율만 바꾸므로
  실제 바뀌는 값을 적는다. 예 — 「장기 침체: 물가 1.5%, 원화 약세」.
  지금 문구(「성장이 오래 정체되고」)는 주식 3% 덮어쓰기를 가리키던 말이라 그대로 두면
  거짓말이 된다.
- **리스크 성향**: 남는 두 선택지의 설명을 「수익률을 정한다」가 아니라 「여러 가정에서
  검증할지」로 고쳐 쓴다.

## 테스트

### 신규

1. **`applyEconomicScenario`가 수익률을 바꾸지 않는다** — 네 국면 각각에서 `assets`·
   `privatePensions`·`isaAccounts`의 `totalReturn`이 입력과 동일하고, `inflationRate`·
   `exchangeScenario`만 바뀐다.
2. **회귀: 저장된 프리셋이 계획을 지배하지 않는다** — `strategy.riskProfile: 'conservative'`가
   담긴 JSON을 로드해 컴파일하면 자산별 `totalReturn`이 입력값 그대로다.
   («이 작업 이전에는 5%로 바뀌었다»가 이 테스트가 고정하는 사실이다.)
3. **마이그레이션 멱등** — 옛 세 값이 `'ai_recommended'`로 떨어지고, 두 번 적용해도 같다.
4. **σ 유도** — `yieldPreset: 'conservative'`가 남아 있어도
   `resolveMonteCarloConfig(params).annualStdDev`가 가중평균 총수익률에서 유도된다.
5. **도우미 왕복** — 프리셋 적용 → 저장값이 5/3%로 바뀜 → `restoreCustomYieldPreset` →
   원래 값 복원.
6. **민감도 3행** — 프리셋 행 셋이 나오고, 각 행이 해당 프리셋으로 계산된 결과와 일치한다.
7. **후보 축 제거** — `StrategyCandidateGenerator`가 만든 후보에 서로 다른 `yieldPreset`이
   섞이지 않는다.

### 기존 픽스처

`riskProfile`이 세 값 중 하나인 픽스처는 컴파일 오류로 드러난다. `'ai_recommended'`로
바꾸되, **수익률 기대값이 프리셋에 기대고 있던 테스트는 개별로 확인한다** — 깨졌다는 것
자체가 그 테스트가 덮어쓰기를 검증하고 있었다는 신호다.

`engineRegression.json`은 값이 움직인다. 검증이 끝난 뒤 갱신하고, 커밋 메시지에 「왜 움직여도
되는가」를 남긴다(픽스처 주석의 규약).

## 구현 순서

1. 테스트 1~4 작성 (실패 확인)
2. 경제 시나리오에서 수익률 제거 (1절) → 테스트 1 통과
3. `RiskProfile` 축소 + `compileStrategy` 호출 제거 (2·3절) → 테스트 2~3 통과
4. σ 유도 고정 (4절) → 테스트 4 통과
5. 자산배분 후보 축 제거 (7절) → 테스트 7
6. 민감도 3행 (5절) → 테스트 6
7. 입력 도우미 + 잠금 해제 (6절) → 테스트 5
8. 문구 (8절)
9. 기존 픽스처 이관 + 전체 테스트 + 골든 갱신

## 위험과 대응

| 위험 | 대응 |
|---|---|
| 사용자가 아무것도 바꾸지 않았는데 결과가 크게 달라진다 | 의도된 정정이다. 저장소에 남아 있던 사용자 입력값이 비로소 계산에 닿는 것이며, 화면이 이미 그 값을 보여주고 있었다 |
| 프리셋이 사라져 「보수적으로 보고 싶다」는 요구가 갈 곳이 없어진다 | 두 곳으로 나뉜다 — 민감도 표의 안정형 행(계획을 바꾸지 않고 결과만 본다)과 입력 도우미(실제로 값을 바꾼다). 후자는 명시적이고 되돌릴 수 있다 |
| 프리셋에 가려 있던 잘못된 입력이 드러난다 | **이 변경의 목적이다.** 실측 시나리오의 JEPI·ISA `totalReturn: 0`이 그렇다 — 배당 7.9%·21.2%와 만나 가격상승 −7.9%·−21.2%가 된다(30년 후 NAV가 원금의 8.5%·0.1%). 잠금이 풀리면 입력칸과 분해 힌트가 그 사실을 그대로 보여주므로 사용자가 고칠 수 있다 |
| `ReturnBreakdownHint`의 「커버드콜이라면 정상입니다」가 여전히 오해를 부른다 | 잠금이 풀리면 힌트가 «엔진이 실제로 쓰는» 값을 계산하게 되어 최소한 숫자는 맞는다. 문구 자체의 재검토는 별도로 다룬다 |
| 후보 축 제거로 추천이 빈약해진다 | 없어지는 것은 「가정을 바꾸라」는 추천뿐이다. 인출 계획·연금 개시·배당 재투자 축은 그대로다 |

# AI 센티널 자동 채움 (AI Sentinel Autofill)

작성일: 2026-08-01

## 배경과 문제

`StrategyMode`('simple' | 'standard' | 'expert')는 화면 노출 범위만 정하고 계산에는 전혀
관여하지 않는다. `grep -rn "StrategyMode" src/`로 확인한 사용처는 타입 선언
(`core/entities/types.ts:370,406`)과 `web/features/StrategySettings/*` UI뿐이며,
`compileStrategy`는 `strategy.mode`를 읽지 않는다. mode만 바꿔 컴파일·시뮬레이션한 결과가
완전히 동일함을 임시 테스트로 확인했다(`compileStrategy` 출력, `utility.totalScore`, 마지막
연도 데이터 모두 일치).

이 자체는 의도된 설계다. 그러나 간편 모드의 설명 문구는 다른 약속을 한다.

> "꼭 필요한 것만 고르면 나머지는 AI가 추천합니다." (`StrategyModeSelector.tsx:11`)

실제로 AI가 값을 바꾸는 시점은 사용자가 각 섹션의 「AI 추천」 버튼을 눌러 **명시적으로
적용할 때뿐**이다. 누르지 않으면 `nationalPensionStrategy: 'ai_optimized'`는 baseline인
65세로 컴파일된다(`compileStrategy.ts:113`). 즉 "AI 최적화"를 골라 둔 사용자는 AI가 아무
일도 하지 않은 결과를 보고 있다.

`'ai_*'` 값의 의미는 코드 주석에 이미 정의되어 있다.

> `'ai_*'` 값은 "아직 미정, 기본값으로 두되 AI 제안을 받겠다"는 표식이며 baseline으로
> 내려간다. (`compileStrategy.ts:238-239`)

이번 작업은 그 표식의 후반부("AI 제안을 받겠다")를 실제 계산에 연결한다.

## 목표

국민연금 수령 개시 나이가 `'ai_optimized'`로 남아 있으면, 시뮬레이션 시점에 추천값으로
채운다. 사용자가 명시적으로 고른 값은 절대 건드리지 않는다.

## 비목표 (이번 범위에서 제외)

- **사적연금 인출량(`privatePensionMonthlyTarget`).** 두 가지 이유로 뺀다.
  (1) 추천이 내놓는 값의 후보 격자는 `targetMonthlySpending × {0.8, 1.0, 1.3}`(기본값 기준
  월 280/350/455만원)인데 이 화면이 표현할 수 있는 값은 `privatePensionLimit/12 ×
  {1, 0.5, 0.25}`(월 125/62.5/31.25만원)로 교집합이 없다
  (`PensionStrategySection.tsx:39-48`).
  (2) 국민연금과 함께 채우면 두 축을 합친 조합이 한 번도 시뮬레이션되지 않은 상태가 된다.
- **목표 생활비 자동 조정.** `recommendedPlan.monthlySpendingMultiplier`는 제외한다. 목표
  생활비는 간편 모드에서 사용자가 직접 입력하는 필드이며(`fieldVisibility.ts:90`), 자동으로
  조정하면 조정된 값 기준으로 재최적화가 돌아 계속 밀리는 발산 위험이 있다.
- **배당 재투자 자동 적용.** `recommendedAssetReinvestment`는 자산 폼에서 사용자가 직접 켜고
  끄는 값이라 센티널이 아니다.
- **ISA 만기 자금 처리.** `preferIsaFirst`는 boolean이라 "미정"을 표현할 수 없다. 기본값
  `false`를 AI가 뒤집으면 사용자가 명시적으로 `false`로 둔 경우와 구분되지 않는다. 센티널을
  추가하는 타입 변경(`'ai' | 'asset' | 'pension'`)은 `compileStrategy`·UI·저장된 시나리오
  마이그레이션까지 번지므로 별도 작업으로 남긴다.
- **`riskProfile`/`economicScenario`/`objective`.** `'ai_recommended'` 센티널은 있지만
  `RecommendationEngine`이 이 축에 대한 추천을 생산하지 않는다. 채울 값 자체가 없다.
- **Phase 4 축**(`recommendedPrivatePensionChanneling`,
  `recommendedNewPensionContribution`). 사용자 설정이 아니라 별도 행동 권고이며 params에
  반영하는 경로가 다르다.
- **로딩 구간 UX 개선.** 추천 도착 전 baseline으로 렌더되는 구간은 기존 "탐색 중" 표시로
  덮는다(아래 트레이드오프 참조).

## 설계 결정

| 결정 | 선택 | 근거 |
|---|---|---|
| 적용 범위 | AI 센티널 축만 | 사용자 입력값을 건드리지 않아 발산 루프가 원천 차단된다 |
| 적용 방식 | 계산 시점에만 채움 (params 불변) | 사용자가 고른 적 없는 값이 시나리오에 저장되는 것을 막는다 |
| 발동 조건 | 센티널이면 모든 모드 | 센티널의 의미가 모드에 따라 달라지지 않는다 |
| 1차 축 | 국민연금 개시 나이 하나 | 조합 미검증 문제를 피한다 |

## 아키텍처

### 새 순수 함수

`src/core/usecases/strategy/applyAiSentinels.ts`:

```ts
export function applyAiSentinels(
  compiled: CompiledStrategy,
  recommendation: StrategyRecommendation | undefined
): CompiledStrategy
```

`compileStrategy` **뒤에 붙는 별도 단계**다. `compileStrategy` 안에 넣지 않는 이유는
시그니처 순환이다: `compileStrategy(params)`가 추천을 반영하려면 추천이 필요한데,
`recommendStrategy`는 이미 컴파일된 params를 입력으로 요구한다 — 서로의 출력을 서로의
입력으로 요구하는 순환이라 한 함수로 합칠 수 없다.

### 데이터 흐름 (`src/app/simulator/page.tsx`)

```
activeParams → compiled ─────────────────────┬─→ useBackgroundValue → recommendStrategy → recommendation
                  │                          │                                                  │
                  └─→ applyAiSentinels(compiled, recommendation) ←──────────────────────────────┘
                                    ↓
                            engine.run(effective.params, effective.utilityConfig)
```

되먹임이 구조적으로 불가능한 이유: 추천 계산의 입력은 항상 사용자 원본 `compiled`이고,
센티널이 채워진 `effective`는 `engine.run`과 화면 표시로만 흘러간다. `page.tsx:159`가 이미
`useBackgroundValue(compiled)`로 원본을 넘기고 있어 그 배선은 그대로 둔다.

### 적용 규칙

전략은 `resolveStrategy(compiled.params)`로 읽는다. `compileStrategy`가 결과에 `strategy`를
함께 찍어 두므로(`compileStrategy.ts:319`) 재유도 없이 그대로 읽힌다.

다음 조건이 **모두** 참일 때만 `withdrawalPlan.nationalPensionStartAge`를
`recommendedPlan.nationalPensionStartAge`로 교체한다.

1. `resolveStrategy(compiled.params).nationalPensionStrategy === 'ai_optimized'`
2. `recommendation !== undefined`
3. `recommendation.improved === true`
4. `recommendation.recommendedPlan !== null`
5. 추천 나이가 현재 컴파일된 나이와 다름

하나라도 거짓이면 **입력 객체를 참조 그대로 반환**한다. 새 객체를 만들면 `page.tsx`의 하위
`useMemo`가 전부 무효화되어 이 화면에서 가장 무거운 렌더가 매번 다시 돈다.

`utilityConfig`는 건드리지 않고 그대로 전달한다.

## 표시 (UI)

`PensionStrategySection.tsx:34-37`에 이미 AI 힌트가 있다. 현재는 추천이 있으면 무조건
`"68세부터 수령"`을 보여준다. 이 문구가 이제 두 갈래로 갈린다.

| 상태 | 문구 |
|---|---|
| 센티널 + 추천 있음 (자동 적용됨) | `68세로 계산에 반영됨` |
| 확정 enum(`normal` 등) + 추천 있음 (미적용) | `68세부터 수령 (추천)` |
| 추천 없음 / 개선 없음 | 표시 없음 |

이 구분은 선택 사항이 아니다. 같은 문구를 쓰면 화면은 "AI 최적화"라고만 말하는데 엔진은
68세로 계산하는 상태와, 추천만 있고 반영되지 않은 상태를 사용자가 구분할 수 없다. 이는 이
저장소가 반복해서 제거해 온 결함 유형이다(`compileStrategy.ts:173-175`의 "폼은 사용자
입력값을 보여주는데 엔진은 프리셋 값으로 계산했다").

## 알려진 한계 (수용)

**1. marginal 효과가 정확히 재현된다고 보장할 수 없다.**
`computeItemizedContributions`는 각 필드를 하나씩만 적용한 조합을 실제로 시뮬레이션하지만
(`RecommendationEngine.ts:249-252`), 그 기준점인 `getIdentityPlan`은 `params.withdrawalPlan`을
읽지 않고 하드코딩된 기본값을 쓴다(`StrategyCandidateGenerator.ts:87-100`). 국민연금 나이는
양쪽 모두 65로 일치하지만 `privatePensionMonthlyTarget`은 어긋난다 — identityPlan은
`targetMonthlySpending`(정액 인출)인 반면 센티널 컴파일 결과는 키 삭제(균등분할)다. 따라서
itemized의 `utilityDelta`를 "자동 채움의 효과"로 그대로 쓸 수 없고, 런타임 개선 검증
로직은 두지 않는다. 적용 근거는 "추천 엔진이 전역 최적화에서 고른 나이"이며, 표시로 그
사실을 정직하게 알린다.

**2. `recommendation`은 항상 한 커밋 뒤처진다.**
`useBackgroundValue`가 `compiled`를 한 커밋 미뤄서 `recommendationCompiled`를 만들기 때문에,
최초 로드 시에만 "baseline(65세)으로 렌더된 뒤 갱신"이 일어나는 것이 아니다. 이후 사용자가
값을 편집할 때마다 `compiled`는 그 렌더에서 즉시 갱신되지만 `recommendation`은 직전 값을
한 커밋 더 들고 있으므로, 그 구간의 `result`는 baseline이 아니라 **"새 params + 직전
추천의 나이"**로 계산된 결과다. 사용자에게 보이는 결과는 같다 — 기존 "AI가 최적 인출
전략을 탐색하고 있습니다..." 표시(`RecommendationChecklist.tsx:27`)가 매 편집마다 이 구간을
덮으므로 1차 범위에서는 추가 처리를 하지 않는다.

## 테스트 계획 (TDD)

**단위 — `applyAiSentinels`**

1. `nationalPensionStrategy: 'ai_optimized'` + 개선 추천 있음 → `withdrawalPlan.nationalPensionStartAge`가 추천값으로 바뀐다
2. 확정 enum(`normal`, `defer_max` 등)이면 추천이 있어도 값이 바뀌지 않는다
3. `recommendation === undefined`이면 입력과 **참조가 동일한** 객체를 반환한다
4. `recommendedPlan === null`이면 참조가 동일한 객체를 반환한다
5. `improved === false`이면 참조가 동일한 객체를 반환한다
6. 추천 나이가 현재 값과 같으면 참조가 동일한 객체를 반환한다
7. `withdrawalPlan`의 다른 필드와 `utilityConfig`는 그대로 보존된다
8. 사용자가 `withdrawalPlan`에 직접 넣은 필드(일반자산 인출 개시 나이 등)가 유실되지 않는다

**통합**

9. 센티널 params + 추천 68세 → `engine.run` 결과가 `nationalPensionStartAge: 68`을 직접 지정한 params의 결과와 동일하다
10. 되먹임 회귀 — `recommendStrategy`에 넘어가는 params가 센티널 미적용 원본이다

**UI — `PensionStrategySection`**

11. 센티널 + 추천 있음 → "계산에 반영됨" 문구를 표시한다
12. 확정 enum + 추천 있음 → "추천" 문구를 표시한다
13. 추천 없음 → 힌트를 표시하지 않는다

## 영향 범위

| 파일 | 변경 |
|---|---|
| `src/core/usecases/strategy/applyAiSentinels.ts` | 신규 |
| `src/app/simulator/page.tsx` | `engine.run` 입력을 `applyAiSentinels` 결과로 교체 |
| `src/web/features/StrategySettings/sections/PensionStrategySection.tsx` | `nationalHint` 문구를 두 갈래로 분기 |
| `src/tests/core/usecases/strategy/applyAiSentinels.test.ts` | 신규 |
| `src/tests/web/features/StrategySettings/sections/PensionStrategySection.test.tsx` | 케이스 추가 |

`ItemizedContribution` 타입은 변경하지 않는다(marginal 검증을 두지 않기로 했으므로 `field`
추가가 불필요해졌다).

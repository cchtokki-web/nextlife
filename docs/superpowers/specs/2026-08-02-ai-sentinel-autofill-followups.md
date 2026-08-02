# AI 센티널 자동 채움 — 후속 과제

작성일: 2026-08-02
대상 브랜치: `feat/ai-sentinel-autofill` (`c59530c`..`45d971f`, 8 커밋)
관련 문서: [설계 스펙](2026-08-01-ai-sentinel-autofill-design.md) · [구현 계획](../plans/2026-08-01-ai-sentinel-autofill.md)

5개 태스크 구현 중 각 태스크 리뷰와 전체 브랜치 리뷰에서 나온 지적 중, **병합을 막지 않는다고
판정되어 미룬 것들**이다. 스크래치 원장이 사라져도 이 문서가 기록으로 남는다.

**2026-08-02 2차 리뷰 추가분(4~9번).** 푸시 전 `origin/develop..develop` 전체를 논리적 정합성·사용자
필요성 기준으로 다시 검토하며 나온 것들이다. 같은 회차에서 **레거시 통과 경로 덮어쓰기, 개발 모드
인증 우회, `upsert`의 premium 기본값, AI 버튼 섹션 게이트 누락, 히어로 기준선 불일치**는 즉시
수정했고, 아래 항목들은 설계 판단이 필요해 남겼다.

**4번(자동 채움의 개선 미보장)도 2026-08-02 해결했다** — 이 묶음의 뿌리였다. 다만 그 수정은
"악화되면 채우지 않는다"는 안전장치일 뿐이라, 채워진 경우의 **표시** 문제(1·5·7·8번)는 그대로
남아 있다.

---

## 우선 처리 권장

### 4. ~~자동 채움 결과는 추천 엔진이 평가한 적 없는 계획이라 "개선"이 보장되지 않는다~~ (2026-08-02 해결)

**해결됨.** `StrategyRecommendation.nationalPensionOnlyUtility`를 추가해, 추천 나이 하나만 사용자의
실제 인출계획에 얹었을 때의 효용을 `currentUtility`와 **같은 기준선**에서 계산한다
(`RecommendationEngine.computeNationalPensionOnlyUtility`). `applyAiSentinels`는 이 값이
`currentUtility`보다 높을 때만 채우고, 낮거나 같거나 계산 불가(null)면 사용자 계획을 그대로 둔다.

아래 수정안 1번(`itemizedContributions`의 marginal 효용 재사용)은 **채택하지 않았다.** 착수 후
확인해 보니 그 값의 기준점이 `identityPlan`이라 나이 효과와 인출계획 차이가 섞여 있어, 게이트로
쓰면 엉뚱한 것을 재게 된다. 2번(단일 축 재채점)을 택했고, 비용은 `runForUtility` 1회다 — 이미 최대
218개 후보를 돌리는 함수이고 호출부가 트랜지션 우선순위에서 실행하므로 화면 반응성 영향은 없다.

**이 방어가 무의미한 항상-참이 아님을 실측으로 확인했다.** 6개 픽스처 중 `improved: true`인 5개를
조사한 결과 2개가 차단됐다:

| 픽스처 | 전체 추천 효용 | baseline | 나이 축만 | 판정 |
|---|---|---|---|---|
| 자산 적음 | 48 | 38 | 38 | **차단**(개선 없음) |
| 조기은퇴(45세→50세 은퇴, 월 400만) | 60 | 39 | **38** | **차단**(악화) |

특히 조기은퇴 케이스는 자동 채움이 사용자 점수를 39 → 38로 **떨어뜨리면서** "AI 적용: 70세부터
수령" 배지를 다는, 이 항목이 지적한 결함 그대로다. 두 케이스 모두 회귀 테스트로 고정했다
(`applyAiSentinels.test.ts`의 「통합 — 실제 추천 엔진」 블록).

**남은 한계:** `applyAiSentinels`가 받는 `compiled`는 최신 렌더의 값인 반면 `recommendation`은
`useBackgroundValue`로 한 커밋 뒤처진 params에서 계산된 것이라, 두 입력이 어긋나는 순간에는 게이트
판정도 그만큼 낡았다. 나이 값 자체가 이미 같은 성질의 지연을 갖고 있어 새로 생긴 문제는 아니다
(별도 항목으로 다룰 것).

<details>
<summary>원래 분석 (기록 보존)</summary>

#### 자동 채움 결과는 추천 엔진이 평가한 적 없는 계획이라 "개선"이 보장되지 않는다

`src/core/usecases/strategy/applyAiSentinels.ts:48-58`

**아래 1번보다 근본적인 문제이며, 1번·5번·8번이 모두 여기서 파생된다.**

추천 엔진은 후보를 평가할 때 `withdrawalPlan`을 **통째로 교체**한다
(`RecommendationEngine.ts:156-168` `paramsForCandidate`; `monthlySpendingMultiplier`는
`userProfile.targetMonthlySpending`까지 스케일링한다). 즉 `recommendedPlan`은 6개 필드를 **함께**
최적화한 결과다. 그런데 `applyAiSentinels`는 그중 `nationalPensionStartAge` **하나만** 이식한다:

| 필드 | compiled(`ai_optimized`) | 평가된 후보 plan |
|---|---|---|
| `privatePensionMonthlyTarget` | **키 자체가 삭제됨** (`compileStrategy.ts:298-300`) | `targetMonthlySpending × {0.8, 1.0, 1.3}` |
| `generalAssetWithdrawalStartAge` | 없음 | `{retirementAge, 62, 65, 70}` |
| `assetSellOrderStrategy` | 없음 | 3종 그리드 |
| `monthlySpendingMultiplier` | 없음 | `{1, 1.1, 1.2}` |

이 차이가 사소하지 않다는 근거는 이 저장소 자신의 주석에 있다 — `RecommendationEngine.ts:390-393`:
"identityPlan은 `privatePensionMonthlyTarget`이 항상 채워진 완결 plan이라 `withdrawalPlan` 미지정과
다르게 동작한다(**동일 params에서 72점 vs 65점으로 갈리는 것을 확인함**)."

**결과:** 그리드가 "60세 조기수령 + 일반자산 인출 70세 연기"를 *묶어서* 최적으로 골랐다면 센티널은
"60세 조기수령"만 이식한다 → 일반자산은 은퇴 즉시 인출되는 채로 국민연금만 평생 −30% 깎인 계획이
실행된다. 사용자는 아무것도 누르지 않았는데 백그라운드 추천이 도착하는 순간 점수가 baseline보다
**떨어지고**, 배지는 "AI 적용: 60세부터 수령"이라고 말한다.

`applyAiSentinels.test.ts:210`('센티널을 채우면 baseline과 결과가 달라진다')은 "결과가 baseline과 달라진다"만 단언한다 — **효용 비감소 불변식은
어디에서도 검증되지 않는다.**

**수정안(비용 순):**
1. `RecommendationEngine.ts:244-269` `computeItemizedContributions`가 이미 `nationalPensionStartAge`
   단일 축의 marginal 효용을 계산한다. 그 값이 **양수일 때만** 채우면 추가 시뮬레이션 0회로 대부분의
   악화 사례를 막는다. 기준점이 `identityPlan`이라 완전한 보장은 아니다.
2. `effective`를 한 번 더 채점해 `currentUtility`보다 낮으면 적용을 취소(시뮬레이션 +1회).
3. 센티널로 표현 가능한 축을 함께 적용하고 그 조합을 후보로 실제 평가(정공법, 비용 큼).

</details>

### 1. 대시보드 AI 추천 체크리스트가 이미 적용된 변경을 "할 일"로 계속 제시한다

`src/web/features/Dashboard/recommendation/RecommendationChecklist.tsx:56` ·
`src/web/features/Dashboard/hero/AiSummaryHero.tsx:68`

**이 브랜치가 새로 만든 불일치다.** 자동 채움 이전에는 센티널이어도 AI가 아무것도 하지 않았으므로
"국민연금을 70세까지 연기 수령합니다"라는 제안이 일관됐다. 이제 엔진은 이미 70세로 계산하는데
같은 문구가 체크 아이콘과 함께 할 일 목록에 남는다.

개선폭 숫자도 두 곳에서 갈렸다:

| 표면 | 기준 | 값 |
|---|---|---|
| 체크리스트 (`totalUtilityDelta`) | `recommendedUtility.score − currentUtility.score` — `currentUtility`는 **센티널 미적용(65세)** | A |
| 히어로 (`{utility.score} → {recommendedUtility.score}`) | `utility`는 `result.utility` — **자동 채움된(70세)** | B |

**이 표의 히어로 쪽은 2026-08-02 해결됐다** — 왼쪽 항을 `recommendation.currentUtility.score`로
바꿔 체크리스트와 같은 기준선을 쓰게 했다(`AiSummaryHero.tsx`). 이제 두 표면의 산술이 맞는다.

**남은 것은 "이미 적용된 항목을 할 일로 제시한다"는 본래 문제다.** 개별 항목 문구가
`identityPlan`(65세) 대비로 생성되므로(`RecommendationEngine.ts:213-215`), 엔진이 이미 70세로
돌고 있어도 "국민연금을 70세까지 연기 수령합니다"가 체크 아이콘과 함께 목록에 남는다.

최종 리뷰어 판정: 구현 이탈이 아니라 **계획의 공백**. 설계 문서는 UI 분기를
`PensionStrategySection` 한 곳만 다뤘지만, 그 분기를 정당화한 논거("같은 문구를 쓰면 사용자가 두
상태를 구분할 수 없다")가 체크리스트에 더 강하게 적용된다.

수정하려면 `RecommendationEngine`의 `itemizedContributions` 기준점까지 건드려야 하므로 그 자체로
브레인스토밍이 필요한 설계 문제다. 2026-08-02 사용자 결정으로 별도 작업으로 분리했다.

**착수 시 참고:** `applyAiSentinels`가 "무엇을 채웠는지"를 반환하는 형태(예:
`{ compiled, appliedFields }`)로 확장하면 표시 계층이 추측하지 않아도 된다. 지금은 축이 하나라
`CompiledStrategy` 하나만 반환하는 것이 합리적이지만, 두 번째 축(사적연금·ISA)이 붙는 순간
이 확장이 필요해진다.

---

### 5. 「AI 추천」 버튼을 눌러도 결과가 안 바뀌는데 배지는 '적용' → '추천'으로 강등된다

`src/web/features/StrategySettings/StrategySettingsPanel.tsx:159-182` ·
`src/web/features/StrategySettings/sections/PensionStrategySection.tsx:40`

`nearest`는 `'ai_optimized'`를 필터로 제외하므로(`:166`) 센티널 사용자에게는 항상 patch가 만들어져
버튼이 활성이다. 누르면:

1. 라디오가 "최대 연기 (70세)"로 이동
2. `compileStrategy`가 70을 내므로 `applyAiSentinels`가 더는 개입하지 않음 →
   **`engine.run` 결과가 클릭 전과 완전히 동일. 대시보드 숫자가 하나도 안 움직인다.**
3. `nationalHintApplied`가 false가 되어 배지가 **"AI 적용" → "AI 추천"으로 내려간다**
4. 덤으로 `preferIsaFirst`가 함께 뒤집힌다(`:171,180`)

방금 명시적으로 적용했는데 라벨이 강등되고 결과는 그대로다. 자동 채움 이전에는 이 클릭이 65→70을
만들어 숫자가 실제로 움직였다.

### 6. 간편 모드에 배당 재투자 추천을 적용할 경로가 0개다

`src/web/features/StrategySettings/fieldVisibility.ts:36-44, 79-93`

대시보드는 `✓ "삼성전자"의 배당을 재투자로 전환합니다 (+5점)`을 제시하는데, 이를 적용하는 유일한
컨트롤은 「투자 전략」 섹션 헤더의 AI 버튼이다. `c59530c`가 도입한 `isSectionVisible`가 간편 모드에서
이 섹션을 통째로 제거한다(`SECTION_FIELDS.investment`는 `riskProfile`/`economicScenario`뿐이고 둘 다
`SIMPLE_FIELDS`에 없다). 「연금 전략」의 '배당금 재투자' 스위치도 `assets.reinvestDividend`가
`SIMPLE_FIELDS`에 없어 숨겨진다. 브랜치 이전에는 6개 섹션이 항상 렌더돼 빈 「투자 전략」의 AI 버튼을
누를 수 있었다. **간편 모드가 기본 모드**(`DEFAULT_RETIREMENT_STRATEGY.mode = 'simple'`)다.

### 7. 자동 적용 사실이 대시보드 어디에도 문장으로 없다

신규 사용자는 기본값이 `'ai_optimized'`라 아무것도 고르지 않아도 센티널 상태다. 추천이 70세를 내면
별점·효용 점수·자산곡선·PDF가 전부 70세 기준이 되는데, 이를 알리는 유일한 표면이 접힌 섹션 안의
FieldRow 배지다(모든 섹션이 접힌 채 마운트 — `StrategySettingsPanel.tsx:259-260`).
`nationalPensionStartAge`를 문장으로 말하는 대시보드 컴포넌트는 `src/web/` 전체에 없다.

### 8. Before/After 토글이 서로 다른 기준선을 비교한다

`src/web/features/Dashboard/DashboardSection.tsx:81`

`'current'` = `result`(센티널 적용된 effective), `'after'` = `recommendedResult`(센티널 미적용
baseline 위에서 계산). 국민연금 나이는 이미 양쪽이 같으므로 "연기 수령 효과"만 통째로 사라져 보이고
나머지 축의 효과가 상대적으로 과장된다.

**단순 수정이 불가능하다는 점을 확인했다.** `StrategyRecommendation`에 `baselineResult`를
`currentResult`로 노출해 `'current'` 쪽을 그것으로 바꾸는 방법을 시도했으나, 그러면 **기본 대시보드가
엔진이 실제로 돌리지 않은 결과를 보여주게 된다** — `useBeforeAfterToggle.ts:8-11`의 주석이 명시하듯
`'current'`는 "방금 편집한 내용이 실제로 반영된 화면"이어야 한다.

4번 해결(악화 시 자동 채움 차단)로도 이 항목은 남는다 — 게이트를 통과해 실제로 채워진 경우
`result`는 여전히 "baseline + 나이"이고 `recommendedResult`는 "baseline + 전체 추천"이라 두 항의
기준선이 다르다. 근본 해법은 추천을 `effective` 기준으로 다시 측정하거나, 자동 채움된 축을
추천 항목에서 제외해 After가 "여기서 더 갈 수 있는 곳"을 뜻하게 만드는 것이다. 1·5번과 같은
설계 묶음이다.

### 9. 센티널 5개 중 1개만 동작하는데 UI 언어가 동일하다

「연금 전략」 섹션에서 국민연금 `ai_optimized`(자동 적용됨)와 사적연금 `ai_optimized`(무동작)가 위아래
줄에 같은 라벨·⭐추천·Sparkles 아이콘으로 놓인다. 차이는 배지 유무뿐이고, 배지가 없는 이유가
"계산 중"인지 "바꿀 게 없음"인지 "원래 무동작"인지 화면이 말하지 않는다(정답은 세 번째이고 근거는
`PensionStrategySection.tsx:42-51` 주석에만 있다).

| 축 | 기본값 | 자동 채움 | 화면 표시 |
|---|---|---|---|
| 국민연금 | `ai_optimized` | O | "AI 적용: 70세부터 수령" |
| 사적연금 | `ai_optimized` | X | 없음 |
| 생활비 전략 | `'ai'` | X | 옆 필드에 "AI 추천: N만원"(수동 적용 필요) |
| 목표 우선순위 | `ai_recommended` | X | 없음 |
| 리스크 성향 / 경제 시나리오 | `ai_recommended` | X | 간편 모드에선 섹션 자체가 없음 |

최소한 국민연금 'AI 최적화' 옵션 설명에 "선택하면 AI가 계산한 나이가 그대로 시뮬레이션에 적용됩니다"를
넣어 세 축의 계약을 화면에서 구분한다.

---

## 표시·접근성

### 2. AI 배지가 '추천'과 '적용'을 글자 하나로만 구분한다

`src/web/components/form/FieldRow.tsx:37-41`

색·테두리·배경이 동일하다. 한쪽은 "지금 돌아간 계산의 사실"이고 다른 쪽은 "제안"인데 시각 위계가
같다. 적용 상태에 solid 배경이나 체크 아이콘을 주는 정도의 구분이 필요하다.

---

## 검증하지 못한 것

### 3. `page.tsx`의 센티널 배선에 통합 테스트가 없다

설계 문서 테스트 계획 #10("되먹임 회귀 — `recommendStrategy`에 넘어가는 params가 센티널 미적용
원본이다")은 단위 수준 불변성 테스트로 대체됐다. 그것은 "함수가 입력을 변형하지 않는다"만
증명하고 "`page.tsx`가 `compiled`를 넘긴다"는 증명하지 못한다.

누군가 `useBackgroundValue(compiled)`를 `effective`로 바꾸면 되먹임 루프가 생기는데, 이를 잡아낼
자동 장치가 없다. `src/tests/app/simulator/`에는 `error.test.tsx`뿐이라 페이지 테스트 인프라가
없는 상황에서의 타협이다.

---

## 범위에서 의도적으로 뺀 것 (설계 문서 "비목표" 참조)

아래는 미완이 아니라 **결정**이다. 근거는 설계 문서에 있다.

- **사적연금 인출량**(`privatePensionMonthlyTarget`) — 추천 격자(월 280/350/455만원)와 화면
  선택지(월 31/62/125만원)의 교집합이 없고, 국민연금과 함께 채우면 두 축을 합친 조합이 한 번도
  시뮬레이션되지 않은 상태가 된다.
- **목표 생활비 배수**(`monthlySpendingMultiplier`) — 사용자가 직접 입력하는 값이고, 자동 조정하면
  조정된 값 기준으로 재최적화가 돌아 계속 밀리는 발산 위험이 있다.
- **배당 재투자** — 자산 폼에서 사용자가 직접 켜고 끄는 값이라 센티널이 아니다.
- **ISA 만기 처리**(`preferIsaFirst`) — boolean이라 "미정"을 표현할 수 없다. 센티널 추가는 타입
  변경이 `compileStrategy`·UI·저장된 시나리오 마이그레이션까지 번진다.
- **`riskProfile`/`economicScenario`/`objective`** — `'ai_recommended'` 센티널은 있지만
  `RecommendationEngine`이 이 축에 대한 추천을 생산하지 않는다. 채울 값이 없다.

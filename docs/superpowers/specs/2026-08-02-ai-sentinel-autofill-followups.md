# AI 센티널 자동 채움 — 후속 과제

작성일: 2026-08-02
대상 브랜치: `feat/ai-sentinel-autofill` (`c59530c`..`45d971f`, 8 커밋)
관련 문서: [설계 스펙](2026-08-01-ai-sentinel-autofill-design.md) · [구현 계획](../plans/2026-08-01-ai-sentinel-autofill.md)

5개 태스크 구현 중 각 태스크 리뷰와 전체 브랜치 리뷰에서 나온 지적 중, **병합을 막지 않는다고
판정되어 미룬 것들**이다. 스크래치 원장이 사라져도 이 문서가 기록으로 남는다.

---

## 우선 처리 권장

### 1. 대시보드 AI 추천 체크리스트가 이미 적용된 변경을 "할 일"로 계속 제시한다

`src/web/features/Dashboard/recommendation/RecommendationChecklist.tsx:56` ·
`src/web/features/Dashboard/hero/AiSummaryHero.tsx:68`

**이 브랜치가 새로 만든 불일치다.** 자동 채움 이전에는 센티널이어도 AI가 아무것도 하지 않았으므로
"국민연금을 70세까지 연기 수령합니다"라는 제안이 일관됐다. 이제 엔진은 이미 70세로 계산하는데
같은 문구가 체크 아이콘과 함께 할 일 목록에 남는다.

개선폭 숫자도 두 곳에서 갈린다:

| 표면 | 기준 | 값 |
|---|---|---|
| 체크리스트 (`totalUtilityDelta`) | `recommendedUtility.score − currentUtility.score` — `currentUtility`는 **센티널 미적용(65세)** | A |
| 히어로 (`{utility.score} → {recommendedUtility.score}`) | `utility`는 `result.utility` — **자동 채움된(70세)** | B |

개별 항목 문구도 `identityPlan`(65세) 대비로 생성된다(`RecommendationEngine.ts:213-215`).

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

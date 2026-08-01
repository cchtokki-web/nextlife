# 은퇴 전략 설정 재설계 — 후속 과제

작성일: 2026-08-01
대상 브랜치: `check_values` (`59b558e`..`fc753b9`, 33 커밋)
관련 문서: [설계 스펙](2026-07-31-retirement-strategy-settings-design.md) · [구현 계획](../plans/2026-07-31-retirement-strategy-settings.md)

10단계 구현 중 각 단계 리뷰와 전체 브랜치 리뷰에서 나온 지적 중, **병합을 막지 않는다고 판정되어 미룬 것들**이다.
각 항목은 발견 시점과 미룬 근거를 함께 적는다. 스크래치 원장이 사라져도 이 문서가 기록으로 남는다.

---

## 우선 처리 권장

### 1. `householdEndAge` prop이 optional이라 같은 버그가 재발할 수 있다

`src/web/features/Dashboard/hero/AiSummaryHero` — `householdEndAge?: number`이고 `userProfile?.expectancy ?? 90`으로 폴백한다.
프로덕션 호출부는 항상 값을 넘기지만, **새 호출부가 빠뜨리면 타입 에러 없이 C2 결함이 그대로 되살아난다**(파산하는 계획에 "고갈 위험 없음" 표시).

prop을 필수로 바꾸고 기존 테스트 호출부 6곳을 고치면 구조적으로 재발 불가능해진다.

### 2. C2와 같은 결함이 두 곳에 남아 있다

Task 5가 `depletionAge`를 가구 종료 나이 기준으로 바꾼 뒤, 본인 기대수명과 비교하는 코드가 두 곳 더 있다.

- `src/core/usecases/dashboard/computeSensitivityAnalysis.ts:60` — `depletionAge ?? expectancy`를 "고갈 없음" 센티널로 쓴다. 장수 배우자가 있으면 95세 고갈 시나리오가 **고갈이 전혀 없는 baseline보다 10년 낫다고** 보고된다.
- `src/core/usecases/strategy/RecommendationEngine.ts:339` — `depletionAge >= params.userProfile.expectancy`로 게이트한다.

둘 다 이제 `SimulationResult.householdEndAge`가 있으므로 수정이 저렴하다.

### 3. `targetAssets`의 배선에 테스트가 없다

`computeRetirementTargetAssets`는 순수 함수로 분리되어 산술 계약은 테스트되지만, `calculateRetirementScore`가 실제로 `retirementStartResult.spendingFactor`/`.healthcareSpending`을 넘기는지는 아무도 검증하지 않는다.
`computeRetirementTargetAssets(target, 1, 0)`으로 회귀시켜도 **신규 테스트 5개가 전부 통과하고 스냅샷도 안 깨진다**(해당 fixture는 factor 1 / healthcare 0).

배우자나 의료비를 켠 상태의 `retirementScore` end-to-end 테스트가 `src/tests` 전체에 없다.

### 4. 일회성 의료비가 은퇴 연도에 걸리면 4% 룰 분모가 부풀려진다

`src/core/usecases/SimulationEngine.ts:278`이 `retirementStartResult.healthcareSpending`(그 해 **총** 의료비)를 넘긴다.
`shockAge === retirementAge`이거나 `longTermCareStartAge === retirementAge`이면 일회성 3천만원이 25배로 곱해져 목표 자산에 7.5억이 더해지고 `assetScore`가 0에 수렴한다(은퇴 준비도 100점 중 최대 25점 손실).

영구 연금 분모에는 **반복 구성요소만** 들어가야 한다. 기본값(쇼크 75세 / 장기요양 80세 vs 은퇴 60~65세)에서는 발동하지 않아 미뤘다.

---

## 모델링 한계 (의도된 단순화, 문서화 목적)

이 브랜치의 범위 결정("계좌는 가구 합산, 생존·연금 기준만 분리")에서 직접 따라오는 것들이다.

- **가구 합산 과세표준** — 두 사람의 연금을 1인 소득으로 평가해 건강보험료·금융소득종합과세 임계를 실제보다 빨리 넘는다.
- **유족연금이 사망자의 청구 개시 전에는 0** — 60세 사망 + 청구 예정 65세면 65세까지 지급이 없다. 실제 제도는 사망일부터 지급한다.
- **`otherIncomes`에 소유자 개념이 없다** — 배우자의 임대·근로 소득이 사후에도 계속된다.
- **일회성 의료비 쇼크에도 생존 인원 축소 계수(0.7)가 적용된다** — 사망자 몫이면 0, 생존자 몫이면 전액이 더 정확하다.
- **`dividend_only` 전략은 분모에만 `spendingFactor`가 적용된다** — 배당 소득은 사망으로 줄어드는 "필요"가 아니므로 설계상 옳지만 비일관으로 읽힐 수 있다.
- **은퇴 전 `fireAge` 판정에 의료비가 반영되지 않는다** — 의료비가 은퇴 후에만 정의된 모델 구조상의 한계.
- **`targetAssets`와 `utilityAnalysis.appropriateBalance`의 배수 결정** — 4% 룰의 25배, 적정 상속 개월수 등에 의료비를 어떻게 반영할지는 모델링 판단이라 보류했다.

---

## 미완 배선

- **`resolveTaxLawProfile`의 프로덕션 호출부가 0이다.** `params.taxLawVersion`을 엔진이 읽지 않아 ⑥고급 설정의 "세법 버전" 셀렉터가 장식적이다. 선택지가 `'current'` 하나뿐이라 지금은 오해를 일으키지 않지만, 셀렉터를 숨기거나 배선하거나 결정이 필요하다.
- **`RiskProfile`의 `'custom'`과 `'ai_recommended'`가 동작상 100% 동일하다.** 둘 다 `compileStrategy`에서 no-op이며, 나이 기반 AI 프로필 선택 로직은 존재하지 않는다.
- **비교 시나리오가 `compileStrategy`를 거치지 않는다** (`src/app/simulator/page.tsx:185`의 `engine.run(scenario.data)`). 현재는 컴파일이 동작 보존적이라 무해하다.
- **레거시 `params.spendingStrategy`/`userProfile.targetBequest`가 `strategy` 생성 후에도 지워지지 않는다.** 영구히 가려지므로 무해하나, 미래의 import/migration 경로가 `strategy`를 떨어뜨리면 stale 값이 씨앗으로 되살아난다.

---

## 표시·접근성

- `SettingSection`의 `role="region"`에 `aria-labelledby`가 없어 이름 없는 landmark다.
- `SwitchField`가 `role="switch"`인데 네이티브 체크박스 외형이다.
- 섹션 문구가 존재하지 않는 번호를 참조한다 — 제목에는 번호가 없는데 본문은 "④투자 전략", "③연금 전략"을 쓴다. 참조 표기법도 3가지다.
- 통화 접미사가 일부 하드코딩되어 있다 — `displayCurrency`가 `'USD'`면 한 섹션에 "USD"와 "원"이 공존한다(목표 상속자산, 의료비 3종).
- 간편 모드에서 빈 섹션 처리가 일관되지 않다 — `AdvancedSection`만 "왜 비어 있는지" 안내문을 렌더한다.
- 간편 모드에서 환율 조회 실패가 조용하다 — 스위치와 에러 문구가 함께 숨겨지는데 조회 자체는 모드와 무관하게 실행된다.
- PDF가 `baseExchangeRate`를 인쇄하면서 `exchangeScenario`를 언급하지 않는다(경제 시나리오가 이 값을 교체한다).
- AI 추천 버튼이 섹션별로 할 일이 없어도 활성화된다 — `aiDisabled={!ai.improved}`가 패널 전역 판정이라, 적용해도 조용히 아무 일도 일어나지 않는 경우가 있다.
- 에러 메시지가 버튼의 `aria-label`로 들어간다.

---

## 변경 배지 정확도

- **`diffDefaults`가 부모 조건을 모른다** (13개 경로). 의료비 스위치를 켜면 `DEFAULT_HEALTHCARE` 8개 키가 한 번에 써져 "8개 변경"이 뜨는데 화면에는 3개만 보인다. `SECTION_FIELDS`를 `{ path, parentCondition }` 형태로 바꾸면 구조적으로 해결된다.
- spouse/healthcare는 기준값이 `undefined`라 **스위치만 눌러도 하위 필드 전부에 배지**가 붙고, 다시 꺼도 배지가 남는다. 같은 오탐을 `useLatestExchangeRate`/`baseExchangeRate`에 대해서는 명시적으로 막아 두어 정책이 비대칭이다.
- 레거시 씨앗으로 유도된 `strategy.*` 값에는 배지가 붙지 않는다(기준값이 `DEFAULT_RETIREMENT_STRATEGY`이므로). 기저의 `userProfile.targetBequest` 경로에는 붙는다.
- `isAssetReinvestChanged`가 `initialParams`에 없는 사용자 추가 자산을 변경으로 보지 않는다.
- `SECTION_FIELDS` 계약 테스트가 "`isFieldVisible` 호출"을 기록하지 별 "렌더"를 기록하지 않아, 두 번째 조건 뒤에 숨은 경로도 커버된 것으로 집계된다.

---

## 코드 구조

- `AssetFormSection.tsx`(1655줄)와 `src/app/simulator/page.tsx`(989줄+)가 크다.
- `SimulationEngine.runSingle()`이 ~540줄 3중 중첩 루프다. Task 5·9가 각각 이 루프에 기능을 얹었고, 다음 기능 전에 연도 루프 본문 추출을 검토할 만하다. (이번엔 변경이 3곳 국소 수정이라 추출이 더 위험하다고 판단해 보류했다.)
- `compileStrategy.ts`가 ~200줄에 5개 축이다. 한눈에 보이는 편이 낫다고 판단해 분해하지 않았다.
- 콤마 파싱 로직이 8곳에 중복되고, 대부분의 숫자 입력에 `min`/`max` 클램프가 없다. `type="number"`를 비우면 `Number('') === 0`이 조용히 저장된다.
- 배지 pill Tailwind 문자열이 `ChangedBadge.tsx`와 `SettingSection.tsx`에 각각 있다.
- `TAX_LAW_PROFILES`의 배열이 `readonly`가 아니고 `taxRates` export와 인스턴스를 공유한다(현 소비처는 읽기 전용).
- `restoreCustomYieldPreset`의 프로덕션 호출부가 0이다. `applyYieldPreset`이 컴파일 사본에만 적용되어 되돌릴 대상이 생기지 않으므로 데이터 손실 위험은 아니다.
- `glossary.ts`의 `pensionSavings` 항목이 정의만 되고 쓰이지 않으며, 서로 다른 3개 필드가 모두 `tooltipTerm="irp"`를 쓴다.
- `SwitchField`의 `accent-[var(--color-primary,#6366f1)]`가 이 트리에서 유일한 하드코딩 hex 폴백이다.
- `resolveSpouse`가 `NaN`을 클램프하지 않는다(UI에서 도달 불가, 방어적 사항).
- `HelpTip`의 `term`(GLOSSARY 조회) 분기가 테스트되지 않는다.

---

## 검증하지 못한 것

**수동 UI 검증 3항목이 미확인이다.** `/simulator`가 `withAuth` 미들웨어에 막히고(`307 → /login`) 이 환경에 브라우저 자동화가 없어, 다음을 사람 눈으로 확인하지 못했다.

- 좌측 설정 변경이 우측 대시보드에 즉시 반영되는가
- 6개 섹션이 모두 정상적으로 펼쳐지는가
- 렌더된 레이아웃과 간격

배선(`<StrategySettingsPanel params={activeParams} onChangeParams={handleUpdateActiveParams} />`)은 이번 작업이 만든 것이 아니라 그대로 유지된 줄이며, `npm run build` 성공과 일회성 스모크 테스트로 대체했다.
전체 브랜치 리뷰가 찾은 결함 상당수(히어로 모순, PDF 오귀속, 유령 배지)가 정확히 이 검증에서 드러날 종류였으므로, **병합 전 실제 실행 확인을 권장한다.**

`compileStrategy.legacy.test.ts`의 fixture에 `isaAccounts`/`withdrawalPlan`/`spouse`/`healthcare`가 없어, 컴파일이 실제로 쓰는 필드에 대해서는 불변식이 테스트가 아니라 코드 읽기로만 확인되었다.

# 입력 패널 재설계 (Phase 2 — 2/5) 설계

## Context

Phase 1(결과 화면 IA 재구조화)과 Phase 2-1(리스크 알림 카드)에 이어, 마스터 프롬프트가 요구한
"현재 입력 화면: 왼쪽 패널이 너무 깁니다. 결과 화면에서는 입력값을 최소화합니다. 예) 현재 나이/
은퇴 나이/월 투자금/투자성향 정도만 보여줍니다. 나머지는 설정 보기 버튼으로 숨깁니다"를 구현한다.

현재 좌측 패널은 `ScenarioManager`(214줄) → `AssetFormSection`(1637줄, 5개 탭) →
`SimulationSettings`(235줄) → `TaxSettingsSection`(142줄, Pro 전용) 4개 컴포넌트가 각각 독립적인
`useState(true)` 기반 collapse로 순서대로 나열되어 있어, 기본 상태에서 화면이 매우 길다. Phase 1에서
만든 공용 `Collapse`(`src/web/components/ui/Collapse.tsx`)는 아직 이 좌측 패널에 적용되지 않았다.

## 범위

이번 스펙은 좌측 패널 상단에 **항상 보이는 핵심 요약 카드**(현재나이/은퇴나이/목표월생활비/
투자성향, 직접 수정 가능)를 추가하고, 나머지 상세 설정(AssetFormSection/SimulationSettings/
TaxSettingsSection)을 **하나의 Collapse(기본 닫힘)**로 묶는 것만 다룬다. `ScenarioManager`는
"설정"이 아니라 핵심 탐색 행위(저장된 시나리오 전환)로 보고 핵심카드 바로 아래 항상 노출을
유지한다. 1637줄짜리 `AssetFormSection.tsx`의 내부 구조(5개 탭, 자산/연금/ISA 카드)는 이번
스펙에서 전혀 건드리지 않는다 — 회귀 위험이 가장 큰 파일이므로 손대지 않고 그 앞에 새 레이어만
추가한다.

## 데이터 모델 제약 확인

`SimulationParams`에는 마스터 프롬프트가 말한 "월 투자금" 같은 단일 집계 필드가 없다(자산/연금별
`monthlyContribution`이 배열 항목마다 분산되어 있음). 대신 `userProfile.targetMonthlySpending`(목표
월 생활비)을 핵심 필드로 쓴다 — 이미 시뮬레이션을 직접 구동하는 최상위 단일 값이라는 점에서
"월 투자금"의 대체재로 가장 적절하다는 판단(사용자 확인 완료).

## 리팩터링: `applyYieldPreset` 추출

투자성향 프리셋(보수적/기본값/공격적) 적용 로직은 현재 `SimulationSettings.tsx` 내부에 export되지
않은 클로저로 존재한다(67-81행):

```tsx
const applyYieldPreset = (preset: 'conservative' | 'base' | 'aggressive') => {
  let stockGrowth = 7, pensionReturn = 4;
  if (preset === 'conservative') { stockGrowth = 5; pensionReturn = 3; }
  else if (preset === 'aggressive') { stockGrowth = 9; pensionReturn = 6; }

  const updatedAssets = activeParams.assets.map((a: any) => ({ ...a, annualGrowthRate: stockGrowth }));
  const updatedPensions = activeParams.privatePensions.map((p: any) => ({ ...p, annualReturn: pensionReturn }));

  handleUpdateActiveParams({
    ...activeParams,
    assets: updatedAssets,
    privatePensions: updatedPensions,
    yieldPreset: preset,
  });
};
```

새 핵심 요약 카드도 동일한 프리셋 버튼을 제공해야 하는데, 이 로직을 그대로 복붙하면 두 곳(기존
`SimulationSettings`, 신규 `QuickSettingsSummary`)에 동일한 비즈니스 로직이 중복되어 나중에
한쪽만 수정되면 조용히 어긋날 수 있다. 순수 함수로 추출한다:

`src/core/usecases/scenario/applyYieldPreset.ts`:

```ts
export function applyYieldPreset(
  params: SimulationParams,
  preset: 'conservative' | 'base' | 'aggressive'
): SimulationParams {
  let stockGrowth = 7;
  let pensionReturn = 4;
  if (preset === 'conservative') { stockGrowth = 5; pensionReturn = 3; }
  else if (preset === 'aggressive') { stockGrowth = 9; pensionReturn = 6; }

  return {
    ...params,
    assets: params.assets.map((a) => ({ ...a, annualGrowthRate: stockGrowth })),
    privatePensions: params.privatePensions.map((p) => ({ ...p, annualReturn: pensionReturn })),
    yieldPreset: preset,
  };
}
```

`SimulationSettings.tsx`의 `applyYieldPreset` 로컬 함수는 `handleUpdateActiveParams(applyYieldPreset(activeParams, preset))`
한 줄로 위임하도록 바꾼다(버튼 UI/스타일/`getActivePreset`은 변경 없음 — 오직 계산 로직만 공유
함수로 이동). `QuickSettingsSummary.tsx`는 `onChangeParams(applyYieldPreset(params, preset))`을
그대로 호출한다.

`custom` 상태는 기존과 동일하게 별도 한글 라벨 없이(3개 버튼 중 어느 것도 active 스타일이 걸리지
않는 방식으로만) 표현한다 — 새 용어를 만들지 않는다.

## 방어적 기본값 처리

`AssetFormSection.tsx`와 `DashboardSection.tsx` 모두 `params` prop을 그대로 쓰지 않고, 렌더 최상단에서
`userProfile`/`assets`/`privatePensions` 등에 `rawParams?.xxx || 기본값`을 채운 파생 객체를 만든
뒤에 사용한다(과거 스캔된 시나리오 데이터가 최신 필드를 다 갖추지 못했을 가능성에 대비하는 기존
관례). `page.tsx`는 동일한 `activeParams`를 `QuickSettingsSummary`에도 그대로 넘기므로, 이 컴포넌트도
같은 관례를 따라야 한다 — 그렇지 않으면 `params.userProfile.currentAge`나 `applyYieldPreset` 내부의
`params.assets.map(...)`이 방어 없이 실행되어, 다른 컴포넌트라면 안전하게 처리했을 데이터에서
크래시가 날 수 있다.

`applyYieldPreset(params, preset)` 자체를 방어적으로 만든다(호출하는 쪽마다 따로 방어하지 않도록
단일 지점에서 처리):

```ts
export function applyYieldPreset(
  params: SimulationParams,
  preset: 'conservative' | 'base' | 'aggressive'
): SimulationParams {
  let stockGrowth = 7;
  let pensionReturn = 4;
  if (preset === 'conservative') { stockGrowth = 5; pensionReturn = 3; }
  else if (preset === 'aggressive') { stockGrowth = 9; pensionReturn = 6; }

  return {
    ...params,
    assets: (params.assets ?? []).map((a) => ({ ...a, annualGrowthRate: stockGrowth })),
    privatePensions: (params.privatePensions ?? []).map((p) => ({ ...p, annualReturn: pensionReturn })),
    yieldPreset: preset,
  };
}
```

`QuickSettingsSummary.tsx`는 컴포넌트 최상단에서 `AssetFormSection`과 동일한 패턴으로 `userProfile`
기본값을 채운 파생 변수를 만들어 사용한다:

```tsx
const userProfile = params.userProfile || { currentAge: 35, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 };
```

(이 기본값 리터럴은 `AssetFormSection.tsx`/`DashboardSection.tsx`가 이미 쓰고 있는 것과 동일한
값을 그대로 사용해 세 곳의 기본값이 서로 달라지지 않도록 한다.)

## 신규 컴포넌트: `QuickSettingsSummary`

`src/web/features/Scenario/QuickSettingsSummary.tsx`:

```tsx
interface QuickSettingsSummaryProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
}
```

`AssetFormSection.tsx`의 `handleProfileChange` 패턴을 그대로 재현하되, 위 "방어적 기본값 처리"의
`userProfile` 파생 변수를 기준으로 삼는다(313-321행 기준 응용):

```tsx
const handleProfileChange = (key: keyof SimulationParams['userProfile'], value: number) => {
  onChangeParams({ ...params, userProfile: { ...userProfile, [key]: value } });
};
```

필드 3개는 `InputField`(`src/web/components/InputField.tsx`)로, 프리셋은 기존과 동일한 3버튼으로
구성한다:

- **현재 나이**: `InputField type="number" value={userProfile.currentAge} onChange={(e) => handleProfileChange('currentAge', Number(e.target.value))} suffixText="세"` — 검증 없음(기존 profile 탭과 동일하게, 새 검증을 추가하지 않는다).
- **은퇴 나이**: 위와 동일 패턴, `retirementAge`.
- **목표 월 생활비**: `AssetFormSection`의 콤마 포맷 입력 패턴을 그대로 재현 — `type="text"`,
  표시값 `userProfile.targetMonthlySpending === 0 ? '0' : userProfile.targetMonthlySpending.toLocaleString()`,
  `onChange`에서 `,` 제거 → `Number()` → `isNaN` 체크 후에만
  `handleProfileChange('targetMonthlySpending', numValue)` 호출.
- **투자성향**: `applyYieldPreset(params, preset)` 결과를 `onChangeParams`에 그대로 전달하는 3버튼.
  버튼 라벨 문자열은 `SimulationSettings.tsx`의 것을 그대로 재사용(`"보수적 (주식 5%, 연금 3%)"` 등).

카드 컨테이너는 기존 `GlassCard`로 감싸고, 내부 레이아웃은 Phase 1/2-1 관례대로 Tailwind로
작성한다(2×2 그리드 + 프리셋 버튼 행).

## 배치: `src/app/simulator/page.tsx`

현재 좌측 컬럼(842-888행 부근)은 `GlassCard > ScenarioManager` → `GlassCard > AssetFormSection` →
`GlassCard > SimulationSettings` → `{isPro && GlassCard > TaxSettingsSection}` 순이다. 이를 아래
순서로 바꾼다:

```
QuickSettingsSummary                      ← 신규, GlassCard 자체 포함, 항상 보임
GlassCard > ScenarioManager                ← 기존 그대로, 항상 보임
Collapse "설정 자세히 보기" (기본 닫힘)      ← 신규 wrapper
  GlassCard > AssetFormSection              ← 기존 그대로(내부 무변경)
  GlassCard > SimulationSettings            ← 기존 그대로(applyYieldPreset 호출부만 위임)
  {isPro && GlassCard > TaxSettingsSection} ← 기존 그대로
```

`isSidebarOpen` 토글(설정 패널 전체 접기/펼치기, CSS 클래스 기반)은 변경하지 않는다 — 이번
변경은 그 안쪽 구조 재배치만 다룬다.

## 테스트 전략

- `applyYieldPreset.test.ts`: 3개 프리셋 각각의 stockGrowth/pensionReturn 값 검증, `assets`/
  `privatePensions` 배열의 모든 항목이 매핑되는지, `yieldPreset` 필드가 정확히 설정되는지, 다른
  필드(`userProfile` 등)는 변경되지 않는지.
- `QuickSettingsSummary.test.tsx`: 4개 필드가 렌더링되는지, 각 입력 변경 시 `onChangeParams`가
  기대한 형태의 객체로 호출되는지(현재나이/은퇴나이/목표월생활비 개별 케이스), 프리셋 버튼 클릭 시
  `onChangeParams`가 `applyYieldPreset` 결과와 동일한 객체로 호출되는지.
- `SimulationSettings.tsx`의 기존 프리셋 관련 동작(있다면)이 리팩터링 후에도 동일하게 유지되는지
  기존 테스트로 확인(별도 신규 테스트는 이 리팩터링 자체보다 `applyYieldPreset.test.ts`가 이미
  로직을 충분히 커버하므로 최소화).
- `page.tsx`는 기존에 컴포넌트 테스트가 없는 파일이라(인증/훅 의존성 큼) 신규 테스트를 추가하지
  않고, 개발 서버에서 육안으로 배치를 확인한다.

## 검증 방법

`npm test`(신규 테스트 포함 전체 통과), `npx tsc --noEmit`, `npm run build`. 개발 서버에서 핵심
요약 카드의 4개 필드를 직접 수정했을 때 시뮬레이션 결과가 실제로 갱신되는지, "설정 자세히 보기"를
펼쳤을 때 기존 `AssetFormSection`/`SimulationSettings`가 그대로(레이아웃 깨짐 없이) 나오는지,
프리셋 버튼을 눌렀을 때 핵심 요약 카드와 "설정 자세히 보기"를 펼친 `SimulationSettings`의 활성
프리셋 표시가 서로 일치하는지 확인한다.

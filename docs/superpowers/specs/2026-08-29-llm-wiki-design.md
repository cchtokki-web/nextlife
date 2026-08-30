# LLM Wiki — Obsidian 보관함 기반 개념·결정 지식 레이어

## 배경

NextLife의 지식은 이미 여러 층에 쌓여 있다. `AGENTS.md`의 계산 계약, `docs/PRD.md`의
제품 요구, `docs/superpowers/specs` 18건과 `plans` 15건의 설계 결정, `docs/releases` 3건,
그리고 프로덕션 코드 약 40,000줄과 테스트 약 49,000줄이다.

문제는 문서가 없는 것이 아니라 **문서끼리, 그리고 문서와 코드 사이에 대응 관계가 없는 것**이다.
「배당을 이중 계상하지 않는다」는 규칙은 `AGENTS.md`에 한 줄로 있고, 그 규칙이 사는 코드는
`src/core/usecases/returns/decomposeReturn.ts`이며, 그 규칙을 지키는 테스트는
`src/tests/core/usecases/SimulationEngine.dividendAccounting.test.ts`인데, 이 셋을 잇는 것은
사람의 기억뿐이다. 작업자(사람이든 에이전트든)는 매번 300줄짜리 PRD와 8,900자짜리 AGENTS.md를
처음부터 읽고 관련 조각을 스스로 찾아야 한다.

이 설계는 그 사이에 **개념 레이어**를 넣는다. 개념 하나당 노트 하나를 두고, 노트가 원자료·코드·
테스트·다른 개념을 `[[링크]]`로 가리키게 한다. 보관함은 Obsidian으로 열어 백링크와 그래프 뷰로
연결 구조를 확인한다. 노트는 순수 마크다운이므로 Obsidian 없이도, 어떤 LLM으로도 읽을 수 있다.

참고한 방식은 https://happy-metamong.tistory.com/50 의 "LLM Wiki" 구성이다. 원문은 논문 PDF를
`raw/`에 쌓고 LLM이 `wiki/papers`·`wiki/concepts`·`wiki/comparisons`를 자동 생성하는 구조인데,
NextLife는 raw에 해당하는 원자료가 이미 존재하므로 그 부분을 재사용한다.

## 목표

- 계산 계약과 도메인 규칙을 개념 노트로 분해하고, 각 노트가 근거 원자료·코드·테스트를 가리킨다.
- 과거 설계 결정을 ADR로 남겨 "왜 그렇게 결정했는가"를 코드 옆에서 찾을 수 있게 한다.
- 노트가 가리키는 경로와 링크가 깨지면 테스트가 실패하여, 위키가 조용히 낡는 것을 막는다.
- 작업 시작 시 읽을 진입점을 `docs/wiki/색인.md` 하나로 만든다.

## 비목표

- 기존 `docs/PRD.md`, `AGENTS.md`, `specs`, `plans`, `releases`를 이동하거나 삭제하지 않는다.
  이들은 raw 자료로 제자리에 남는다.
- 제품 코드의 동작을 바꾸지 않는다. 계산 로직·도메인 모델·저장 포맷 변경이 없다.
- NextLife 사용자에게 노출되는 기능이 아니다. 개발 보조 문서 인프라다.
- 노트 본문의 의미적 정확성을 자동 검증하지 않는다(§무결성 테스트의 한계 참조).
- 코드베이스 모듈 지도(`SimulationEngine` 해부 등)는 이번 범위가 아니다. 후속으로 분리한다.
- `wiki/comparisons/`는 만들지 않는다. 필요해질 때 추가한다.

## 구조 결정

### 보관함 위치

Obsidian 보관함 루트는 **repo 루트**다. `docs/wiki/`가 아니라 repo 루트인 이유는, 개념 노트가
`[[AGENTS]]`, `[[PRD]]`, `[[2026-08-19-total-return-unification-design]]` 같은 기존 원자료를
직접 링크해야 하고 Obsidian은 보관함 밖 파일을 링크 대상으로 인식하지 못하기 때문이다.

위키 파일 자체는 repo 안 `docs/wiki/`에 두고 git으로 추적한다. repo 밖에 두면 코드 변경과 함께
리뷰·머지되지 않아 반드시 낡는다. 이는 `AGENTS.md`의 문서 현행화 원칙과 직결된다.

`.obsidian/`은 개인 설정이므로 `.gitignore`에 추가한다.

### 보관함 오염과 파일명 충돌

보관함이 repo 루트이므로 `node_modules`가 보관함 «안»에 들어온다. 2026-08-29 실측:

| | 개수 |
| --- | --- |
| `node_modules` 안 마크다운 | 1,367 |
| repo의 실제 문서 | 48 |
| `node_modules` 안 `README.md` | 532 |
| `node_modules` 안 `index.md` | 39 |

두 가지 대응이 필요하다.

1. **Obsidian 설정 → 파일 및 링크 → 제외된 파일에 `node_modules`를 추가한다.** 검색·퀵
   스위처·그래프 뷰·링크 제안에서 빠진다. 0단계의 필수 절차이며, 빠뜨리면 그래프에서 실제
   문서가 28:1로 묻힌다.
2. **위키의 고정 문서를 `위키 사용법.md`·`스키마.md`·`색인.md`로 둔다.** 제외 설정은 «숨길»
   뿐 보관함에서 빼지 않으므로, `README.md`라는 이름을 쓰면 `[[README]]`가 532개 후보와
   계속 충돌한다. 이름 자체를 겹치지 않게 하는 것이 유일한 해결이다.

`.gitignore`로는 이 문제를 풀 수 없다. git이 무시하는 것과 Obsidian이 보관함에 넣는 것은
별개다.

### 폴더 매핑

| 원문(블로그) | NextLife | 비고 |
| --- | --- | --- |
| `raw/` | `AGENTS.md`, `docs/PRD.md`, `docs/superpowers/**`, `docs/releases/**` | 기존 위치 유지 |
| `wiki/papers/` | `docs/wiki/decisions/` | 원자료 1건 = ADR 1건 |
| `wiki/concepts/` | `docs/wiki/concepts/` | 핵심. 백링크가 모이는 곳 |
| `wiki/comparisons/` | (없음) | 이번 범위 아님 |
| `schema.md` | `docs/wiki/스키마.md` | 생성 규칙 |

```text
<repo 루트>                ← Obsidian 보관함 루트
├─ AGENTS.md               ┐
├─ docs/PRD.md             ├ raw 자료 (이동 없음)
├─ docs/superpowers/       ┘
└─ docs/wiki/              ← 신규
   ├─ 위키 사용법.md        사용법
   ├─ 스키마.md             생성 규칙
   ├─ 색인.md               MOC (진입점)
   ├─ concepts/
   └─ decisions/
```

## 노트 포맷

### 개념 노트 (`docs/wiki/concepts/*.md`)

```markdown
---
type: concept
status: enforced          # enforced | partial | not-implemented
sources: ["[[AGENTS]] 금융 및 계산 원칙", "[[PRD]] §8.3"]
code: [src/core/usecases/returns/decomposeReturn.ts]
tests: [src/tests/core/usecases/SimulationEngine.dividendAccounting.test.ts]
tags: [계산계약, 배당]
---
# 총수익률과 배당수익률

## 한 줄 정의
## 계약
## 흔한 위반
## 근거
## 관련
```

`status`는 `AGENTS.md`의 "구현된 기능, 제한적 기능, 미구현 기능을 구분한다" 원칙을 노트 단위로
강제한다. 예로 소득세법 시행령 제40조의2 연금수령한도는 공식이 core에 있으나 production 입력에
연금수령 기산연도가 없어 실제 준수 여부가 `미판정`이므로 `status: partial`이다. 이 구분이 없으면
"코드에 있으니 동작하는 기능"으로 오독된다.

`## 흔한 위반`은 이 위키에서 값이 가장 큰 섹션이다. `AGENTS.md`에 이미 「`totalReturn`과
`dividendYield`를 더해 배당을 이중 계상하지 않는다」, 「`max_sustainable` 도달 가능성 오판」 같은
실제 실패 사례가 기록돼 있다. 이를 해당 개념 노트에 붙여 같은 실수의 재발 확률을 낮춘다.

### ADR (`docs/wiki/decisions/*.md`)

```markdown
---
type: decision
decided: 2026-08-19
source: "[[2026-08-19-total-return-unification-design]]"
affects: ["[[총수익률과 배당수익률]]", "[[현금 배당과 재투자 배당]]"]
---
# 수익률 입력을 총수익률로 통일

## 결정
## 배경
## 기각한 대안과 범위 제외
## 호환성 처리
## 영향받는 개념
```

파일명 규칙은 아래 §파일명 규칙을 따른다.

### 파일명 규칙

사용자가 Obsidian에서 직접 읽고 링크를 타는 것이 이 위키의 목적이므로 **파일명은 한글로 쓴다.**
영문 슬러그 + `title` frontmatter 방식은 쓰지 않는다. `[[총수익률과 배당수익률]]`이 곧 파일명이
되어야 링크를 손으로 쓸 때와 그래프 뷰에서 읽을 때가 모두 자연스럽다.

- 개념 노트: 개념 이름 그대로. 띄어쓰기 허용. 예 `docs/wiki/concepts/총수익률과 배당수익률.md`
- ADR: 원자료 spec의 날짜 접두사 + 한글 제목. 예
  `docs/wiki/decisions/2026-08-19-수익률 입력을 총수익률로 통일.md`
- 고정 문서: `위키 사용법.md`, `스키마.md`, `색인.md`. `README.md`·`index.md`·`schema.md`를
  쓰지 않는다 — 아래 §보관함 오염 참조.

날짜 접두사를 ADR에만 두는 이유는, 결정은 시점이 의미를 가지지만 개념은 시점과 무관하게
현재 계약을 서술하기 때문이다.

## 파일럿 대상

형식을 6개 노트에서 검증한 뒤 확장한다. 50개를 만든 뒤 포맷을 바꾸면 전량 재작업이 된다.

### 개념 6개

| 개념 | 근거 코드 / 테스트 |
| --- | --- |
| 총수익률과 배당수익률 | `src/core/usecases/returns/decomposeReturn.ts`, `SimulationEngine.totalReturn.test.ts`, `migrateLegacyReturnKeys.test.ts` |
| 현금 배당과 재투자 배당 | `SimulationEngine.dividendAccounting.test.ts`, `DividendReinvestmentOptimizer.test.ts` |
| 원장 불변식 | `src/core/usecases/ledger/YearLedger.ts`, `SimulationEngine.ledger.test.ts`, `retirement-domain-invariants/cashflow.test.ts` |
| HARD와 SOFT 목표 | `src/core/entities/retirementGoal.ts`, `HardConstraintFilter.test.ts`, `targetValueProvenance.test.ts` |
| 명목가치와 실질가치 | `[[PRD]] §8.1`, `src/core/usecases/SimulationEngine.ts` |
| 도달 가능성 5단계 | `maxSustainableReachability.test.ts` |

2단계(검수 지점)에서 만들 것은 앞의 3개 — 총수익률과 배당수익률, 현금 배당과 재투자 배당,
원장 불변식 — 이다. 서로 가장 강하게 얽혀 있어 링크가 실제로 걸리는지를 최소 개수로 판정할 수
있다. 나머지 3개는 3단계에서 만든다.

앞 5개는 계산 계약이고 마지막 1개는 프로세스 규칙이다. 성격이 다른 둘을 의도적으로 섞어, 하나의
`스키마.md`가 양쪽을 담을 수 있는지 파일럿에서 판정한다. 담지 못하면 이 시점에 포맷을 분리한다.

### ADR 3개

유형이 서로 다른 것을 골라 포맷의 적용 범위를 검증한다.

1. `2026-08-19` 총수익률 입력 통일 — 도메인 모델 변경 + 데이터 마이그레이션 유형
2. `2026-08-22` 목표 제약 계층(`hardSpendingFloor` 신규 파라미터) — 신규 제약 도입 유형
3. `2026-08-08` 배우자 기능 제거 — 기능 제거 유형

3번은 연결될 개념 노트가 적어 링크 밀도가 낮다. 그럼에도 포함하는 이유는 "제거 결정을 어떻게
기록하는가"라는 포맷 문제를 파일럿에서 확인하기 위해서다.

## 무결성 테스트

`src/tests/docs/wikiIntegrity.test.ts`를 추가한다. `vitest.config.ts`는 `include`를 덮어쓰지 않고
`exclude`만 지정하므로 이 파일은 설정 변경 없이 `npm test`에 수집된다.

검사 항목:

- frontmatter의 `code`, `tests`는 repo 루트 기준 상대 경로이며 해당 파일이 실제로 존재한다.
- frontmatter의 `sources`, `affects`, `source`는 `[[링크]]`를 포함하는 문자열이며, 그 안의
  링크 대상이 보관함에서 해석된다. 뒤에 붙는 절 표기(`§8.3` 등)는 검사하지 않는다.
- 본문의 `[[링크]]` 대상이 실존하는 노트 또는 보관함 내 파일이다. 깨진 링크는 실패다.
- `type`이 `concept` 또는 `decision`이다.
- `type: concept`은 `status`가 `enforced`, `partial`, `not-implemented` 중 하나다.
- `status: enforced`인 노트는 `tests`가 비어 있지 않다.
- `type: decision`은 `decided`와 `source`를 가진다.

### 한계

이 테스트는 경로 실존과 링크 무결성만 본다. 노트 본문이 코드와 **의미적으로** 어긋나는 것은
잡지 못한다. 배당 규칙이 바뀌었는데 노트 문장이 옛날 그대로여도 테스트는 통과한다. 그 격차는
아래 AGENTS.md 연동 규칙과 사람 검수로만 좁힌다. 이 한계를 `docs/wiki/위키 사용법.md`에도 명시한다.

## AGENTS.md 연동

위키를 만들어도 작업 시작 시 읽지 않으면 값이 0이다. `AGENTS.md`에 다음을 추가한다.

- 작업 시작 전 `docs/wiki/색인.md`에서 관련 개념 노트를 읽는다.
- 계산 계약·도메인 규칙을 바꾸면 해당 개념 노트를 같은 커밋에서 갱신한다.
- 새 설계 결정을 확정하면 `docs/wiki/decisions/`에 ADR을 남긴다.
- 작업 완료 보고 양식에 `10. 위키 갱신 여부`를 추가한다.

앞의 셋은 기존 "문서 현행화 원칙"의 연장이다. 넷째는 보고 계약 자체의 변경이며 사용자 승인을
받았다(2026-08-29).

## 진행 순서

| 단계 | 내용 | 산출물 |
| --- | --- | --- |
| 0 | Obsidian 설치, repo 루트를 보관함으로 열기, `node_modules` 제외 설정 | `.gitignore`에 `.obsidian/` |
| 1 | 규칙 확정 | `docs/wiki/스키마.md`, `위키 사용법.md`, `색인.md` |
| 2 | 파일럿 앞부분 — 가장 얽힌 개념 3개 | 개념 노트 3개. **검수 지점** |
| 3 | 파일럿 완성 — 개념 3개 + ADR 3개 | 노트 6개. Obsidian 그래프 확인 |
| 4 | 검증 장치 | `wikiIntegrity.test.ts`, `AGENTS.md` 수정 |
| 5 | 확장 — 나머지 개념과 남은 spec의 ADR화 | 점진적. 관련 작업 시 채워도 된다 |
| 6 | 상시 개발 루프 | (문서 산출물 없음) |

2단계를 검수 지점으로 두는 이유는 링크가 실제로 걸리는지가 그때 판명되고, 포맷 수정 비용이
그 시점에 가장 싸기 때문이다.

6단계 상시 루프:

```text
작업 시작 → 색인.md에서 관련 개념 노트를 읽는다
     ↓
작업 → 개념 노트의 「계약」과 「흔한 위반」으로 자가 점검
     ↓
완료 → 개념 노트 갱신 + 필요시 ADR 추가 + 보고서 10번 항목
```

## 위험

- **노트가 원자료와 어긋난다.** 개념 노트는 `AGENTS.md`·`PRD`를 요약하므로 원문과 미묘하게
  달라질 수 있다. 완화: 노트의 `## 계약`은 원문 문장을 근거로 인용하고 창작하지 않는다.
  원문과 충돌하면 원문이 우선이며, 노트가 아니라 원문을 고칠 사안인지 먼저 판단한다.
- **위키가 낡는다.** §무결성 테스트가 경로 수준에서만 막는다. 의미 수준은 AGENTS.md 연동
  규칙에 의존하며, 이 규칙이 지켜지지 않으면 위키는 잘못된 근거가 된다.
- **문서 수정 비용이 올라 위키를 안 쓰게 된다.** 무결성 테스트가 지나치게 엄격하면 역효과가
  난다. 완화: 1차 검사 항목을 경로·링크·필수 필드로 제한하고 그 이상 늘리지 않는다.
- **워크트리 분기.** 위키는 `develop-2`에서 만들어진다. `develop` 워크트리와 내용이 갈릴 수
  있으므로 머지 전까지는 `develop-2`를 보관함으로 연다.
- **파일명 한글.** 노트 파일명은 한글로 쓴다(§파일명 규칙). macOS의 유니코드 정규화(NFD/NFC)
  차이로 git에서 파일명이 어긋날 가능성을 2026-08-29에 실측 확인했으며, 이 저장소는
  `core.precomposeunicode = true`(macOS git 기본값)로 한글 파일명이 NFC로 정규화되어 저장된다.
  실질적 위험은 남지 않는다. 다만 리눅스 CI에서 체크아웃할 경우를 대비해 파일럿 단계에서
  `git ls-files`로 한 번 확인한다.

## 완료 기준

- `docs/wiki/`에 `스키마.md`, `위키 사용법.md`, `색인.md`, 개념 노트 6개, ADR 3개가 존재한다.
- 모든 노트가 `스키마.md`의 frontmatter와 섹션 규칙을 만족한다.
- `npm test`가 통과하며 `wikiIntegrity.test.ts`가 위 검사 항목을 실제로 검증한다.
- 의도적으로 경로 하나를 깨뜨리면 `wikiIntegrity.test.ts`가 실패한다(검증 장치가 동작함을 확인).
- `AGENTS.md`에 4개 항목이 반영되고 보고 양식이 10개 항목이 된다.
- `.gitignore`에 `.obsidian/`이 있다.
- 개념 노트 6개가 각각 다른 개념 노트를 최소 1건 링크한다(개념 레이어에 고립점이 없다).
  ADR은 원자료 spec과 `affects` 링크로만 연결돼도 무방하다.

# 자산별 수익률 provenance 설계

**요구** 자산별 수익률의 input / custom snapshot / scenario-adjusted / actually-used 값을
하나의 provenance 구조로 통합한다.

## 조사: 네 값은 지금 어디에 있나

| 값 | 소재 | 상태 |
|---|---|---|
| input | `params.assets[i].totalReturn` (연금·ISA 동일) | 사용자 타이핑·티커 자동조회·프리셋 버튼·스냅샷 복원이 **모두 같은 칸**에 쓴다. 무엇이 썼는지 기록이 없다 |
| custom snapshot | `params.customYieldSnapshot.{assets,privatePensions,isaAccounts?}[id]` | id별로 보존. 「첫 캡처가 이긴다」 |
| scenario-adjusted | 민감도 수익률 3행·`robustness.ts` 변형의 **사본 안에서만** 존재 | 포트폴리오 수준으로만 공시되고 자산별로는 드러나지 않는다 |
| actually-used | = input | `params`→엔진 사이에 `totalReturn`을 다시 쓰는 코드가 없음을 확인했다 |

`applyEconomicScenario`는 수익률을 건드리지 않는다(물가·환율만). 즉 scenario-adjusted를
만드는 경로는 민감도와 robustness 둘뿐이다.

### 출처를 답하는 것처럼 생겼지만 거짓말하는 필드

`params.yieldPreset`. 저장 계층이 키 없는 시나리오에 `'base'`를 채워 넣으므로
(`normalizeSimulationParams`), 누른 적 없는 프리셋이 선택된 것처럼 보인다. `matchedYieldPreset`과
`resolveMonteCarloConfig`가 각자 독립적으로 이 필드를 버리기로 이미 결정해 두었다. 실제
골든 픽스처(`reportCapture.json`)가 그 예다 — `yieldPreset: 'base'`가 저장돼 있지만 자산
수익률은 5%·8%로 base(7%)가 아니다.

## 결정

### 기록하지 않고 유도한다

시나리오는 6자리 보안키 기반 E2EE 데이터다. 저장 스키마에 출처 필드를 추가하면
마이그레이션이 따라오고, 무엇보다 **이미 저장된 모든 시나리오는 여전히 「출처 미상」이 된다** —
기록은 지금부터만 쌓이기 때문이다. 유도는 저장된 모든 시나리오에 오늘 바로 답을 준다.

요구문도 네 값을 「통합」하라고 했지 새로 「기록」하라고 하지 않았고, 넷 다 이미 존재한다.

### origin은 세 단계다

프리셋 수익률(주식 5/7/9, 연금 3/4/6)은 사용자가 손으로 넣어도 이상하지 않은 **둥근 숫자**다.
값이 프리셋과 같다는 사실만으로 「프리셋이 채웠다」고 말하면 7%를 직접 입력한 사용자에게
거짓말을 한다.

- `preset` — 보관값과 **다르**면서 프리셋 값과 **같다**. 프리셋이 덮었다는 강한 증거.
- `indeterminate` — 프리셋 값과 같지만 단정할 수 없다.
- `direct_input` — 어느 프리셋과도 다르다.

`customYieldSnapshot`은 직접입력의 증거가 **못 된다**. `applyYieldPreset`은 스냅샷이 아예
없을 때 지금 값을 최초 1회 캡처하므로, 프리셋 상태로 시작해 한 번도 직접입력을 거치지 않은
계획에서는 스냅샷이 프리셋 값을 담는다. 그래서 `indeterminate`가 필요하다.

### 표시는 말할 것이 있을 때만

초안은 계좌마다 「~프리셋과 같은 값입니다」를 붙였다. 골든 픽스처에서 네 줄 중 세 줄이 서로
**다른** 프리셋 이름을 달았다 — 포트폴리오 전체는 어느 프리셋과도 맞지 않는데도. 출처 정보가
아니라 소음이다. 두 경우에만 인쇄한다.

- `origin === 'preset'`: 되돌릴 수 있는 값이 얼마인지가 실제로 쓸모 있다.
- 포트폴리오 **전체**가 같은 프리셋과 일치할 때: 한 계좌의 우연이 아니라 계획 전체에 대한 진술.

## 기각한 대안과 범위 제외

- **저장 스키마에 출처 기록 추가** — 위 「기록하지 않고 유도한다」 참조. 나중에 필요해지면
  이 구조가 그대로 읽기 표면이 되므로 재작업 없이 얹을 수 있다.
- **티커 자동조회와 직접 타이핑 구분** — 저장된 값만으로는 구분되지 않는다. 구분하려면 기록이
  필요하고, 그것은 위에서 기각한 스키마 변경이다. `direct_input` 주석에 명시했다.
- **자산별 scenario-adjusted 표시 UI** — 구조는 `options.adjusted`로 지원하고 테스트로
  지키지만, 민감도 표는 이미 포트폴리오 수준으로 공시하고 있어 새 UI를 만들지 않는다.
- **`params.yieldPreset` 정정 또는 제거** — 저장된 데이터의 의미를 바꾸는 일이라 범위 밖이다.
  대신 `storedPresetMisleading`으로 어긋남을 드러낸다.

## 호환성 처리

읽기 전용 파생 계층이라 저장 스키마·API 계약·기존 계산 결과가 하나도 바뀌지 않는다.
`customYieldSnapshot.isaAccounts`가 없는 옛 스냅샷은 `null`을 낸다. PDF 출력은 「말할 것이
있을 때만」 규칙 덕분에 골든 픽스처가 한 글자도 바뀌지 않았다.

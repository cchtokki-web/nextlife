# NextLife 은퇴 자산 시뮬레이터

은퇴 후 자산이 어떻게 흘러가는지를 **월 단위로** 계산하는 시뮬레이터입니다. 국민연금·사적연금·
ISA·투자자산·배당을 각각의 세제와 인출 규칙에 따라 다루고, 세금과 건강보험료까지 반영해
"몇 살까지 얼마를 쓸 수 있는가"에 답합니다.

일반적인 은퇴 계산기와 다른 점:

- **월 단위 복리 + 인출 순서** — 현금 → 일반자산 → 사적연금 순으로 부족분을 채우고, 매도 시
  가중평균 원가법으로 실현이익을 계산해 양도소득세에 반영합니다.
- **한국 세제** — 금융소득종합과세(비교과세), 해외주식 양도소득세, 사적연금 저율과세 한도,
  건강보험료 부과 기준까지 계산합니다.
- **평생 효용 점수** — "얼마를 남기는가"가 아니라 "얼마나 잘 쓰는가"를 6개 축으로 평가합니다.
- **확률 기반 분석** — 수익률이 매년 흔들리는 상황을 1,000회 시뮬레이션해 성공 확률을 냅니다.
- **전략 자동 추천** — 인출 계획 5차원을 그리드 탐색하고, 여러 경기 국면에서 최악이 가장
  나은 계획을 고릅니다.

계정은 이메일로 받은 6자리 보안키로 로그인하며, 같은 키로 브라우저에서 자산 데이터를
암호화합니다. 기존 카카오 사용자는 로그인 후 이메일 인증을 거쳐 같은 계정과 데이터를 유지한
채 이메일 로그인으로 전환할 수 있으며, 브라우저에 저장된 현재 보안키를 인증 이메일로 다시
받습니다. 동일 이메일 계정이 이미 있으면 양쪽 시나리오를 개수와 관계없이 모두 병합합니다.
신규 시나리오는 최대 5개까지만 만들 수 있어, 병합으로 5개를 넘은 경우 삭제해 4개 이하가
되기 전까지 더 추가할 수 없습니다.

---

## 시작하기

```bash
npm install
npm run dev          # prisma db push 후 next dev
```

`http://localhost:3000` 에서 열립니다.

> **포트 주의**: 3000번이 이미 쓰이고 있다면 `npm run dev -- -p 3001` 처럼 지정하세요.
> 개발 모드 자동 로그인은 실행 중인 포트를 자동으로 따라갑니다.

### 개발 모드 자동 로그인

로그인 없이 시뮬레이터를 바로 열려면:

```bash
NEXT_PUBLIC_DEV_MODE=true npm run dev
```

개발용 자격증명으로 Pro 계정에 자동 로그인됩니다. 이 분기는 `NODE_ENV !== 'production'`
조건이 함께 걸려 있어 **프로덕션 빌드에서는 통째로 죽습니다.** `NEXT_PUBLIC_` 접두사 변수는
클라이언트 번들에 인라인되고 `.env`가 배포 환경으로 새기 쉬운데, 그 한 번의 사고가 곧바로
완전한 인증 우회가 되기 때문입니다(`src/core/utils/isDevMode.ts`).

---

## 환경 변수

`.env.example`을 `.env`로 복사한 뒤 필요한 값을 채웁니다.

| 변수 | 용도 |
|---|---|
| `DATABASE_URL` | Prisma 연결 문자열 (기본은 SQLite 파일) |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | next-auth 세션 |
| `DEV_NEXTAUTH_URL` | 개발 시 콜백 origin 강제 지정(터널·호스트 별칭용, 선택) |
| `NEXT_PUBLIC_DEV_MODE` | 개발 모드 자동 로그인 |
| `NEXT_PUBLIC_APP_URL` | 메일 링크 등에 쓰이는 공개 URL |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `EMAIL_FROM` | 이메일 가입·보안키 발송 |
| `KAKAO_CLIENT_ID` / `KAKAO_CLIENT_SECRET` | 기존 카카오 계정의 레거시 로그인 호환 |
| `OLLAMA_ENDPOINT` / `OLLAMA_MODEL` | AI 조언 문구 생성 (미설정 시 규칙 기반 폴백) |
| `ADMIN_KEY` | 관리자 API 접근 |

**AI 조언은 선택 사항입니다.** `OLLAMA_ENDPOINT`가 없거나 호출에 실패하면 규칙 기반 문장
생성기가 같은 형식으로 응답합니다. 계산·추천·점수는 전부 결정론적 코드이며 LLM을 쓰지 않습니다.

---

## 스크립트

```bash
npm run dev          # 개발 서버 (prisma db push 포함)
npm run build        # 프로덕션 빌드 (prisma generate 포함)
npm start            # 프로덕션 실행
npm test             # vitest 전체 실행
npm run test:watch   # vitest watch
npm run lint         # eslint
```

---

## 프로젝트 구조

클린 아키텍처를 따릅니다. **`src/core/`는 React·Next.js·DB에 전혀 의존하지 않는 순수
TypeScript**이며, 그래서 Web Worker에서도 그대로 실행됩니다.

```
src/
├── core/                    # 도메인 — 프레임워크 무의존, 순수 함수
│   ├── entities/            # 타입·엔티티 (SimulationParams, SimulationResult 등)
│   └── usecases/
│       ├── SimulationEngine.ts   # 연·월 루프 본체
│       ├── tax/                  # 세법 프로필 + 세금 계산
│       ├── strategy/             # 전략 컴파일·추천·강건성
│       ├── utility/              # 평생 효용 점수 6축
│       ├── montecarlo/           # 확률 경로·몬테카를로·순서 리스크
│       ├── healthcare/           # 의료비·건보료 절벽 추정
│       ├── dashboard/            # 화면·리포트용 파생 계산
│       ├── spouse/               # 배우자 생존·유족연금 규칙
│       └── scenario/             # 경제 시나리오·수익률 프리셋
├── app/                     # Next.js App Router (페이지 + API 라우트)
├── web/                     # 프레젠테이션
│   ├── features/            # 화면 단위 (Dashboard, StrategySettings, Pdf …)
│   ├── hooks/               # useStrategyPipeline, useMonteCarlo …
│   ├── workers/             # Web Worker 진입점
│   └── components/          # 공용 UI
├── infrastructure/          # DB·스토리지 어댑터
└── tests/                   # vitest (core/app/web 구조를 그대로 반영)
```

### 계산 파이프라인

```
사용자 입력(params)
  → compileStrategy      사용자 언어(전략) → 엔진 파라미터
  → recommendStrategy    후보 탐색 후 개선안 도출
  → applyAiSentinels     미정 축만 자동으로 채움
  → engine.run()         시뮬레이션
```

시뮬레이션은 **전부 브라우저에서** 실행됩니다. 시나리오 데이터가 종단간 암호화(E2EE)되어
서버는 평문을 알지 못하기 때문입니다. 몬테카를로만 Web Worker로 분리해 화면을 막지 않습니다.

---

## 테스트

```bash
npm test
```

vitest 기반이며 테스트 파일 132개가 있습니다. 도메인 계층은 순수 함수라 대부분 모킹 없이
실제 엔진을 돌려 검증합니다.

특히 중요한 방어선:

- **총자산 보존 불변식** — `기말자산 = 기초자산 + 유입 − 유출`. 이중과세·세금 증발·매도액
  소실을 한 번에 잡습니다. 골든값은 틀린 채로 굳을 수 있지만 보존식은 그럴 수 없습니다.
- **세금 골든 테스트** — 기댓값 옆에 손계산 유도를 주석으로 남깁니다.
- **전략 축 델타** — 8개 전략 축 전부에 대해 "선택을 바꾸면 **현금흐름**이 바뀐다"를 강제합니다.
  단언을 점수가 아니라 자산 곡선에 겁니다.
- **옵션 추가 시 "미지정이면 기존 결과와 비트 단위 동일"** — 저장된 시나리오의 숫자가 조용히
  달라지는 것을 막습니다.

> **워크트리 주의**: `.worktrees/`를 남겨 둔 채 메인에서 `npm test`를 돌리면 React가 중복
> 로드되어 대량 실패합니다. 병합 후 `git worktree remove`를 먼저 하세요.

---

## 기술 스택

Next.js 16.2 (App Router) · React 19.2 · TypeScript (strict, `any` 금지) · Prisma + SQLite ·
next-auth · recharts · jsPDF + html2canvas · vitest

---

## 문서

- `docs/releases/` — 릴리스별 변경 내역과 그 배경
- `AGENTS.md` / `CLAUDE.md` — 코드 작성 규칙

코드의 설계 판단은 **주석에 회고형으로** 남기는 것이 이 저장소의 관례입니다("예전에는 이랬는데
그게 왜 문제였다"). 특히 `SimulationEngine.ts`와 `tax/TaxEngine.ts`는 수정 전에 주변 주석을
반드시 읽어야 합니다 — 단순해 보이는 코드가 특정 실패를 막기 위한 형태인 경우가 많습니다.

# 기여 안내

NextLife 개선에 관심을 가져 주셔서 감사합니다. 큰 변경은 먼저 이슈에서 문제와 제안 방향을
공유하고, 작고 명확한 pull request로 제출해 주세요.

## 개발 환경

- Node.js 20 이상
- npm
- SQLite (기본 개발 설정)

```bash
npm ci
cp .env.example .env
# .env의 NEXTAUTH_SECRET을 openssl rand -base64 32 결과로 설정
npm run dev
```

이메일 가입과 보안키 발송을 확인하려면 SMTP 환경 변수가 필요합니다. Ollama는 선택 사항이며,
설정하지 않으면 규칙 기반 조언을 사용합니다.

## 변경 제안

- 계산·도메인 변경은 UI에서 데이터가 생성되고 저장된 뒤 실제 추천 경로까지 도달하는지 확인해
  주세요.
- 계산식이나 금융 제도 가정을 바꾸는 pull request에는 근거와 영향 범위를 설명해 주세요.
- 사용자 자산, 소득, 보안키, 토큰을 포함한 실데이터를 이슈·pull request·테스트 자료에 올리지
  마세요. 재현 사례는 가상 데이터로 만들어 주세요.
- 기존 시나리오와 호환성, README 및 관련 제품 문서도 함께 살펴봐 주세요.
- 새 의존성을 추가하면 필요한 이유와 런타임 영향을 설명해 주세요.

## 로컬 확인

```bash
npm run lint
npm test
npm run build
```

pull request는 GitHub Actions에서 린트, 전체 테스트, 프로덕션 빌드를 확인합니다.

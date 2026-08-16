import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    // 기본 5초는 이 스위트에 너무 빠듯하다. 은퇴 시뮬레이션 테스트는 이진탐색과 다중
    // projection을 돌려 정상적으로도 오래 걸리는데, 전체 스위트를 병렬로 실행하면 CPU
    // 경합으로 더 늘어난다. 실측(전체 실행 기준):
    //   strategyAxisDelta 'spendingChoice'        3.6s (단독 2.2s)
    //   useScenarios 재시도/서버 오류 테스트       4.5s
    //   optimizer 선별-vs-전량 검증                4.5s
    // 여유가 10%도 안 남아 간헐적으로 타임아웃으로 죽었다(계산 결함이 아니라 실행 시간 문제).
    // 넉넉히 두는 대가는 "진짜로 멈춘 테스트"를 늦게 발견하는 것뿐이다.
    testTimeout: 30_000,
    // `.claude/worktrees/*`에는 에이전트용 git 워크트리가 들어앉는다. 그 안에도 src 전체가
    // 있어 기본 설정이면 테스트로 수집되는데, 워크트리는 옛 커밋에 고정돼 있고 `@/` 별칭은
    // 부모의 src로 해석되므로 «옛 테스트 × 새 코드» 조합이 만들어져 실패한다. 그 실패는
    // 저장소의 결함이 아니라 수집 범위의 결함이라, 고쳐도 사라지지 않고 계속 쌓인다.
    // (실측: develop에서 `npm test`가 590파일/6340테스트를 돌리고 6건이 이렇게 실패했다.)
    //
    // exclude를 지정하면 vitest의 기본값을 «대체»하므로, 기본값에 있던 항목도 함께 적는다.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/.claude/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

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
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

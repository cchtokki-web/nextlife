import { defineConfig } from 'vitest/config';
import path from 'path';

// 하니스 전용 설정. `npm run harness:personas`가 이 파일로만 vitest를 띄운다.
//
// 기본 vitest.config.ts와 분리하는 이유: 하니스는 회귀 테스트가 아니라 분석 도구이고,
// 51명 × (218개 후보 + 몬테카를로 2,000회)를 도는 동안 CI가 그걸 기다릴 이유가 없다.
// 파일명을 *.harness.ts로 둬 기본 include(**/*.test.*)에도 걸리지 않는다 — 설정과 이름
// 양쪽으로 막아 두면 한쪽이 바뀌어도 실수로 CI에 편입되지 않는다.
//
// environment가 jsdom이 아니라 node인 이유: core 계층은 DOM을 쓰지 않고(엔진·추천·MC 전부),
// 하니스는 React를 렌더하지 않는다.
export default defineConfig({
  test: {
    include: ['scripts/harness/**/*.harness.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 3_600_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

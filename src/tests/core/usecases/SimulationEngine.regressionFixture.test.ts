import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';
import fixture from '@/tests/fixtures/engineRegression.json';

// 계산 엔진 회귀 고정.
//
// 스냅샷과 달리 **입력과 기대값을 사람이 읽는 한 파일에** 둔다(engineRegression.json).
// 엔진을 고쳐 값이 움직이면 diff가 "어느 나이에서 얼마나" 움직였는지를 그대로 보여주고,
// 갱신하려면 그 파일을 직접 고쳐야 하므로 `-u` 한 번으로 조용히 덮이지 않는다.
//
// 값이 움직여도 되는 경우가 있다(세법 프로필 갱신, 지출 곡선 기본값 변경 등). 그때는
// 새 값과 함께 «왜 움직여도 되는가»를 커밋 메시지에 남긴다. 남길 말이 없다면 그것은
// 의도하지 않은 변경이다.
const engine = new SimulationEngine();

describe('계산 엔진 회귀 픽스처', () => {
  for (const testCase of fixture.cases) {
    describe(testCase.name, () => {
      const params = testCase.params as unknown as SimulationParams;
      const result = engine.runSingle(params, undefined, testCase.simulationStartYear);

      test('고갈 나이가 고정값과 같다', () => {
        expect(result.depletionAge).toBe(testCase.expected.depletionAge);
      });

      for (const [ageText, expectedAssets] of Object.entries(testCase.expected.totalAssetsByAge)) {
        test(`${ageText}세 총자산이 고정값과 같다`, () => {
          const year = result.yearlyResults.find((y) => y.age === Number(ageText));
          expect(year).toBeDefined();
          expect(Math.abs(year!.totalAssets - expectedAssets)).toBeLessThanOrEqual(fixture.toleranceKRW);
        });
      }

      // 고정값이 맞더라도 그 값이 회계식으로 설명되지 않으면 의미가 없다. 엔진이 매년
      // 스스로 검사하지만(assertLedgerConsistent), 이 픽스처가 그 검사를 실제로 밟는지를
      // 여기서 확인한다 — 원장이 붙지 않으면 검사도 돌지 않은 것이다.
      test('모든 해에 회계 원장이 붙고 residual이 0이다', () => {
        expect(result.yearlyResults.length).toBeGreaterThan(0);
        for (const year of result.yearlyResults) {
          expect(year.ledger).toBeDefined();
          expect(Math.abs(year.ledger!.residual)).toBeLessThan(1);
        }
      });
    });
  }
});

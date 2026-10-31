import { describe, expect, it } from 'vitest';
import { sameAnalysisInputs } from '@/core/usecases/investmentTracking/sameAnalysisInputs';
import { initialParams } from '@/infrastructure/storage/defaultParams';

describe('분석 입력 동일성', () => {
  it('자동 반영 설정만 바뀌어도 기존 분석 요청을 유지한다', () => {
    expect(sameAnalysisInputs(initialParams, { ...initialParams, autoUpdateEtfPrices: true })).toBe(true);
  });
  it('다른 실제 입력이면 분석 요청을 다시 쓰지 않는다', () => {
    expect(sameAnalysisInputs(initialParams, { ...initialParams, assets: [{ ...initialParams.assets[0], autoHistoricalReturn: true }, ...initialParams.assets.slice(1)] })).toBe(true);
    expect(sameAnalysisInputs(initialParams, { ...initialParams, assets: [{ ...initialParams.assets[0], totalReturn: 99 }, ...initialParams.assets.slice(1)] })).toBe(false);
    expect(sameAnalysisInputs(null, initialParams)).toBe(false);
  });
});

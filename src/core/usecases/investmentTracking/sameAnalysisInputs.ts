import type { SimulationParams } from '../../entities/types';

/** 두 메타데이터만 바뀐 경우 기존 계산 입력과 동일하다. 중첩 필드는 참조가 같아야 한다. */
export function sameAnalysisInputs(left: SimulationParams | null | undefined, right: SimulationParams): boolean {
  if (!left) return false;
  return left === right || Object.keys({ ...left, ...right }).every((key) =>
    key === 'investmentBaseline' || key === 'autoUpdateEtfPrices'
      || (key === 'assets' && sameAssets(left.assets, right.assets))
      || left[key as keyof SimulationParams] === right[key as keyof SimulationParams],
  );
}

function sameAssets(left: SimulationParams['assets'], right: SimulationParams['assets']): boolean {
  return left === right || (left.length === right.length && left.every((asset, index) => {
    const other = right[index];
    return Object.keys({ ...asset, ...other }).every((key) => key === 'autoHistoricalReturn'
      || asset[key as keyof typeof asset] === other[key as keyof typeof other]);
  }));
}

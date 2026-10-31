import type { SimulationParams } from '../../entities/types';

/** 두 메타데이터만 바뀐 경우 기존 계산 입력과 동일하다. 중첩 필드는 참조가 같아야 한다. */
export function sameAnalysisInputs(left: SimulationParams | null | undefined, right: SimulationParams): boolean {
  if (!left) return false;
  return left === right || Object.keys({ ...left, ...right }).every((key) =>
    key === 'investmentBaseline' || key === 'autoUpdateEtfPrices'
      || left[key as keyof SimulationParams] === right[key as keyof SimulationParams],
  );
}

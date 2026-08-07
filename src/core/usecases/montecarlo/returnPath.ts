import { ReturnShockPath } from '../../entities/types';
import { RandomSource, nextStandardNormal } from './rng';

// 연도별 시장 수익률 충격 경로를 만든다.
//
// 분포는 정규분포다. 과거 수익률 데이터가 이 저장소에 없어(부트스트랩/블록 부트스트랩은
// 실제 수익률 시계열을 리샘플링한다) v1에서는 쓸 수 없다. 생성기를 이 함수 뒤에 두었으므로
// 나중에 분포를 바꿀 때 엔진이나 MC 루프를 건드리지 않아도 된다.
//
// **기대값이 0인데도 중앙값은 결정론보다 낮게 나온다.** 복리로 굴리면 기하평균 < 산술평균
// 이기 때문이다(변동성 손실). 이건 버그가 아니라 "연 7%가 30년 내리 유지되는 경우는 거의
// 없다"는 지적의 정량적 실체이고, 화면에서 결정론 곡선과 겹쳐 그려 드러낸다.
//
// 변동성이 0 이하이면 결정론(모든 충격 0)으로 떨어뜨린다. 표준편차에 음수는 의미가 없어
// 던질 수도 있지만, 그러면 사용자 입력 하나로 화면 전체가 죽는다.
export function buildReturnShockPath(
  years: number,
  annualStdDevPercentPoints: number,
  rand: RandomSource
): ReturnShockPath {
  if (years <= 0) return [];

  const sigma = Math.max(0, annualStdDevPercentPoints);
  if (sigma === 0) return new Array(years).fill(0);

  return Array.from({ length: years }, () => nextStandardNormal(rand) * sigma);
}

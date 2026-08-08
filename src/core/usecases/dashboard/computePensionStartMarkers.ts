import { SimulationParams } from '../../entities/types';
import { resolveSpouse, spouseNationalPensionStartSelfAge } from '../spouse/spouseRules';

export interface PensionStartMarker {
  // 본인 나이 기준. 소득 차트의 X축이 본인 나이라 그대로 기준선 위치가 된다.
  age: number;
  label: string;
}

// 소득원 구성 차트에 세로 기준선으로 찍을 "연금이 시작되는 시점".
//
// 이 함수가 있는 이유: 차트의 막대는 국민연금을 본인/배우자 합산으로 그리기 때문에, 배우자가
// 먼저 수령을 시작하는 계획에서는 어느 해에 작은 막대가 하나 생겼다가 다음 해에 갑자기 커진다.
// 데이터만 봐서는 그 이유를 알 수 없다 — 두 개시 시점을 이름과 함께 표시해야 읽힌다.
//
// 배우자 개시 나이는 배우자 나이로 저장되므로 본인 나이로 환산해야 하고, 그 규칙은
// spouseNationalPensionStartSelfAge 한 곳에만 둔다(로드맵도 같은 함수를 쓴다).
export function computePensionStartMarkers(
  params: SimulationParams,
  // 본인 국민연금 개시 나이. 화면이 Before/After 토글로 추천안을 미리 보는 중이면 그 계획의
  // 값이어야 하므로(차트도 추천안 결과를 그린다) 호출부가 정해서 넘긴다.
  nationalPensionStartAge: number
): PensionStartMarker[] {
  const markers: PensionStartMarker[] = [];
  const { currentAge } = params.userProfile;

  // 라벨이 짧은 이유: 이 문자열은 차트 위 기준선에 그려지는데, 본인·배우자 개시가 1~2년
  // 차이면 두 라벨이 나란히 놓인다. 긴 문구는 서로 겹쳐 글자가 뭉개져 읽을 수 없게 된다
  // (실제로 "64세 배 응자세본민연금 굼민연금 시작"으로 렌더된 적이 있다).
  // 로드맵은 자체 문구를 쓰므로 여기 축약이 영향을 주지 않는다.

  // 수령액이 0이면 그 시점에 아무 일도 일어나지 않는다 — 기준선은 소음이 된다.
  if ((params.nationalPension?.expectedMonthlyAmount ?? 0) > 0) {
    markers.push({ age: nationalPensionStartAge, label: '본인 연금' });
  }

  const spouse = resolveSpouse(params.spouse, params.userProfile);
  if (spouse && spouse.nationalPensionMonthlyAmount > 0) {
    const spouseAge = spouseNationalPensionStartSelfAge(spouse);
    // 이미 수령 중이면 차트 구간 안에서 "시작"하는 사건이 아니다.
    if (spouseAge > currentAge) {
      markers.push({ age: spouseAge, label: '배우자 연금' });
    }
  }

  // 같은 해에 둘 다 시작하면 기준선 두 개가 겹쳐 라벨이 서로를 가린다 — 하나로 합친다.
  const byAge = new Map<number, string[]>();
  for (const { age, label } of markers) {
    byAge.set(age, [...(byAge.get(age) ?? []), label]);
  }

  return Array.from(byAge.entries())
    .map(([age, labels]) => ({ age, label: labels.join(' · ') }))
    .sort((a, b) => a.age - b.age);
}

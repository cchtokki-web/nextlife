// 시드를 받는 난수 생성기.
//
// **코어는 Math.random()을 부르지 않는다.** 같은 입력 → 같은 출력은 이 저장소 도메인
// 계층의 계약이고 골든/스냅샷 테스트가 그 위에 서 있다. 확률 시뮬레이션도 그 계약 안에
// 남기려면 난수원을 주입받아야 한다.
//
// 사용자 관점에서도 재현성이 필요하다: 시드가 시각 기반이면 아무것도 바꾸지 않았는데
// 새로고침마다 성공률이 88%↔91%로 흔들려 그 숫자를 믿을 수 없게 된다.

// [0, 1) 균등난수 공급자.
export type RandomSource = () => number;

// mulberry32. 32비트 상태, 주기 2^32, 통계적 품질은 이 용도에 충분하다.
//
// 이걸 고른 이유는 시드를 강하게 섞기 때문이다 — 순차적인 시드(seed, seed+1, ...)를 줘도
// 출력이 상관되지 않는다. 시행별 독립 시드 전략(deriveSeed)이 그 성질에 기댄다.
export function mulberry32(seed: number): RandomSource {
  // 부호 없는 32비트로 정규화. 음수 시드나 소수 시드가 들어와도 동작해야 한다.
  let state = seed >>> 0;

  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 시행 i의 시드를 기준 시드로부터 유도한다(splitmix32 계열 믹서).
//
// 하나의 난수원을 1000시행이 순차 소비해도 전체는 재현되지만, "i번째 시행"만 단독으로
// 다시 만들 수는 없다. 최악 경로를 나중에 재실행해 상세를 뽑거나(전 시행의 연도별 결과를
// 들고 있으면 수십 MB가 된다) 시행 구간을 나눠 처리하려면 시행 단위 재현성이 필요하다.
export function deriveSeed(baseSeed: number, index: number): number {
  let z = (baseSeed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

// 표준정규분포 표본 하나(Box–Muller).
//
// 두 값이 만들어지지만 **두 번째는 버린다.** 캐싱하면 호출자마다 숨은 상태가 생겨
// "n번째 draw"의 재현성이 호출 순서에 의존하게 된다. 균등난수 2개를 소비한다는 규칙을
// 고정하는 편이 디버깅 가능하다.
export function nextStandardNormal(rand: RandomSource): number {
  // u가 정확히 0이면 log(0) = -Infinity가 된다. mulberry32는 0을 만들 수 있으므로 막는다.
  let u = rand();
  while (u === 0) u = rand();

  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

import { describe, test, expect } from 'vitest';
import { describeMonteCarloAssumptions } from '@/core/usecases/montecarlo/describeAssumptions';

// 화면(MonteCarloSection)과 PDF(pdfReportSections)가 같은 문장을 쓰게 하는 단일 출처.
//
// 두 벌로 두었던 대가를 이미 치렀다: 사적연금 충격 배율이 생겼을 때 두 곳이 «동시에»
// 「모든 위험자산이 같은 시장 충격을 공유」라고 말하는 거짓이 됐다. 셋째 소비처가 생기면
// 또 갈라진다.
const base = { annualStdDev: 15, seed: 20260101 };

function copy(economicScenario: string, riskProfile: string) {
  return describeMonteCarloAssumptions({
    ...base,
    assumptions: {
      economicScenario: economicScenario as never,
      riskProfile: riskProfile as never,
    },
  });
}

describe('describeMonteCarloAssumptions', () => {
  // 밝히지 않으면 사용자는 15%p가 모든 계좌에 똑같이 걸린 것으로 읽는다. 이제는 배율이
  // 포트폴리오 구성에 따라 계좌마다 달라지므로 숫자 하나가 아니라 «규칙»을 적는다.
  test('충격이 계좌마다 다르다는 것을 밝힌다', () => {
    expect(copy('ai_recommended', 'ai_recommended').calculation)
      .toContain('계좌별 충격은 기대수익률에 비례');
  });

  // **회귀 방지.** 두 문장 모두 한때 이 자리에 있었고, 배율 규칙이 바뀔 때마다 거짓이 됐다.
  test('충격이 균일하다고 말하지 않는다', () => {
    const { calculation } = copy('ai_recommended', 'ai_recommended');

    expect(calculation).not.toContain('모든 위험자산이 같은 시장 충격');
    expect(calculation).not.toContain('주식·ISA는 같은 시장 충격');
  });

  test('두 축이 모두 미정이면 입력값을 그대로 썼다고 말한다', () => {
    const { calculation } = copy('ai_recommended', 'ai_recommended');

    expect(calculation).toContain('입력하신');
    expect(calculation).toContain('고정 시드 20260101');
    expect(calculation).toContain('연 변동성 15%p');
  });

  test('경제 시나리오가 지배하면 그 국면의 이름을 밝힌다', () => {
    const { calculation } = copy('high_inflation', 'ai_recommended');

    expect(calculation).toContain('고물가');
    // 지배 중이면 사용자 입력이 덮어써진 것이므로 "입력값 그대로"라고 말해선 안 된다.
    expect(calculation).not.toContain('입력하신 물가');
  });

  // 2026-08-22: 리스크 성향은 더 이상 수익률을 지배하지 않는다. 저장된 옛 시나리오에
  // 남은 레거시 값('conservative' 등)이 들어와도 governing 문구를 만들지 않고 "입력하신
  // 가정 그대로"로 떨어져야 한다.
  test('리스크 성향은 더 이상 수익률을 지배하지 않는다', () => {
    expect(copy('ai_recommended', 'conservative').calculation).toContain('입력하신');
  });

  // 'custom'은 "자산마다 직접 넣은 값을 그대로 쓴다"는 뜻이라 지배가 아니다.
  test('사용자 직접입력은 지배로 보지 않는다', () => {
    expect(copy('ai_recommended', 'custom').calculation).toContain('입력하신');
  });

  // **강건성 문장은 미정인 축이 있을 때만 나온다.** 이 문장이 이 작업의 핵심이다 —
  // 설정 화면은 「네 가지 경기 국면 모두에서 견디는 계획을 고릅니다」라고 말하는데,
  // 대시보드의 확률은 입력 가정 하나로 계산한 값이다. 밝히지 않으면 사용자는 표시된
  // 확률이 그 4국면 검증의 산물이라고 읽는다.
  test('미정인 축이 있으면 4국면 비교가 어디에 쓰였는지 밝힌다', () => {
    const { robustness } = copy('ai_recommended', 'ai_recommended');

    expect(robustness).not.toBeNull();
    expect(robustness).toContain('추천');
  });

  test('두 축이 모두 정해져 있으면 강건성 문장이 없다', () => {
    expect(copy('high_inflation', 'conservative').robustness).toBeNull();
  });

  test('한 축만 미정이어도 강건성 문장이 나온다', () => {
    expect(copy('high_inflation', 'ai_recommended').robustness).not.toBeNull();
    expect(copy('ai_recommended', 'conservative').robustness).not.toBeNull();
  });

  // 직렬화된 옛 결과에는 assumptions가 없다. 화면이 죽는 대신 아는 것만 말한다.
  test('가정 정보가 없는 옛 결과에도 문구를 만든다', () => {
    const { calculation, robustness } = describeMonteCarloAssumptions(base);

    expect(calculation).toContain('연 변동성 15%p');
    expect(calculation).toContain('고정 시드 20260101');
    expect(robustness).toBeNull();
  });

  test('변동성이 없는 옛 결과는 기존 표시값 15%p로 되돌린다', () => {
    expect(describeMonteCarloAssumptions({ seed: 1 }).calculation).toContain('연 변동성 15%p');
  });

  // **배율을 모르는 것과 배율이 없는 것은 다르다.** assumptions가 없는 결과라도 그것을 만든
  // 엔진에는 배율이 있다 — 배율은 결과의 속성이 아니라 엔진의 속성이다. 그러니 「모든
  // 위험자산이 같은 시장 충격을 공유」는 여기서도 거짓이다. 모르는 것(그때의 배율 값)은
  // 말하지 않고, 아는 것(연금은 따로 움직인다)만 말한다.
  test('가정 정보가 없어도 모든 자산이 같은 충격을 받는다고 말하지 않는다', () => {
    expect(describeMonteCarloAssumptions({ seed: 1 }).calculation)
      .not.toContain('모든 위험자산이 같은 시장 충격');
  });
});

import { describe, test, expect } from 'vitest';
import { describeSustainableSpendingBasis } from '@/core/usecases/dashboard/describeSustainableSpendingBasis';

// 같은 화면이 「목표 달성 확률 71%」(1,000회 시행)와 「지속 가능한 한도 월 410만원」을
// 나란히 놓는다. 뒤의 값은 결정론 이진탐색(SimulationEngine.searchSustainable —
// returnPath 없는 runSingle 30회)의 결과라 그 확률과 아무 관계가 없다. 기준을 밝히지 않으면
// 사용자는 앞의 확률을 뒤의 금액에도 적용해 「410만원을 써도 71%는 된다」로 읽는다.
describe('describeSustainableSpendingBasis', () => {
  test('어느 세계의 값인지와 판정 나이를 밝힌다', () => {
    const note = describeSustainableSpendingBasis(90);

    expect(note).toContain('현재 수익률과 연금, 물가, 기대수명 가정이 그대로 유지될 경우');
    expect(note).toContain('90세까지');
  });

  // 「권장액」으로 읽히는 것이 이 문장이 막으려는 바로 그 오독이다.
  test('권장액이 아니라 한계값이라고 못박는다', () => {
    const note = describeSustainableSpendingBasis(90);

    expect(note).toContain('계산상 상한');
    expect(note).toContain('권장 생활비를 의미하지 않습니다');
  });

  // 확률을 «지어내지» 않는다. 확률 기준으로 역산한 한도는 새 계산이고 지금 그 값은 없다.
  // 여기서 임의의 백분율을 적으면 근거 없는 숫자가 화면과 PDF에 동시에 박힌다.
  test('확률 수치를 만들어 붙이지 않는다', () => {
    const note = describeSustainableSpendingBasis(90);

    expect(note).not.toMatch(/\d+\s*%/);
    expect(note).not.toContain('목표 달성 확률');
  });

  test('판정 나이는 인자를 따른다', () => {
    expect(describeSustainableSpendingBasis(100)).toContain('100세까지');
  });
});

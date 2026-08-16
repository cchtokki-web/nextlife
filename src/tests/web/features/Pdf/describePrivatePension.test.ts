import { describe, test, expect } from 'vitest';
import { describePrivatePensionLabel } from '@/web/features/Pdf/describePrivatePension';
import type { PrivatePension } from '@/core/entities/types';

// **PrivatePension.name은 선택 필드다**(types.ts). 기본 시나리오의 사적연금에는 이름이 없고,
// PDF가 그 값을 그대로 인쇄해 리포트에 「undefined (IRP)」가 찍혔다. 사용자가 내려받는
// 문서라 눈에 띄는 결함이었다.
//
// 이름이 없을 때 「사적연금」 같은 군말을 넣는 대신 계좌 종류를 이름 자리에 올린다 —
// 이름이 있을 때 붙는 괄호와 중복되지 않고("IRP (IRP)"), 사용자가 실제로 아는 말이다.

function pension(overrides: Partial<PrivatePension> = {}): PrivatePension {
  return {
    id: 'p1',
    type: 'irp',
    balance: 50_000_000,
    monthlyContribution: 400_000,
    annualReturn: 4,
    currency: 'KRW',
    ...overrides,
  };
}

describe('describePrivatePensionLabel', () => {
  test('이름이 있으면 이름과 계좌 종류를 함께 보여준다', () => {
    expect(describePrivatePensionLabel(pension({ name: '미래에셋 IRP' }))).toBe('미래에셋 IRP (IRP)');
  });

  test('이름이 없으면 계좌 종류만 보여준다', () => {
    expect(describePrivatePensionLabel(pension({ type: 'irp' }))).toBe('IRP');
    expect(describePrivatePensionLabel(pension({ type: 'savings' }))).toBe('연금저축');
  });

  // 빈 문자열·공백은 「이름을 지웠다」이지 「이름이 있다」가 아니다. 입력 폼이 빈 문자열을
  // 저장하므로(AssetFormSection의 `pension.name || ''`) undefined만 막으면 부족하다.
  test('이름이 공백뿐이면 없는 것으로 본다', () => {
    expect(describePrivatePensionLabel(pension({ name: '' }))).toBe('IRP');
    expect(describePrivatePensionLabel(pension({ name: '   ' }))).toBe('IRP');
  });

  test('알 수 없는 종류는 기타로 부른다', () => {
    expect(describePrivatePensionLabel(pension({ type: 'other' as PrivatePension['type'] }))).toBe('기타');
  });
});

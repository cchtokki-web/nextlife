import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { AmountField } from '@/web/components/fields/AmountField';
import { NumberField } from '@/web/components/fields/NumberField';
import { parseAmountInput, parseNumericInput } from '@/web/components/fields/numericDraft';

// 부모가 실제로 값을 되돌려 주는 상태를 만든다. 제어 입력의 버그는 «다음 렌더가 옛 값을
// 덮어쓰는» 데서 나오므로, onChange를 mock으로만 두면 그 순간이 재현되지 않는다.
function StatefulNumberField({ initial = 5 }: { initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NumberField label="연 총수익률" step="0.1" suffixText="%" value={value} onChangeValue={setValue} />
      <output aria-label="저장된 값">{value}</output>
    </>
  );
}

function StatefulAmountField({ initial = 1000 }: { initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <AmountField label="현재 잔액" suffixText="원" value={value} onChangeValue={setValue} />
      <output aria-label="저장된 값">{value}</output>
    </>
  );
}

const saved = () => screen.getByLabelText('저장된 값').textContent;

describe('NumberField', () => {
  test('입력한 숫자를 저장한다', () => {
    render(<StatefulNumberField />);

    fireEvent.change(screen.getByLabelText('연 총수익률'), { target: { value: '7' } });

    expect(saved()).toBe('7');
  });

  // 브라우저(와 jsdom)는 type=number 입력에서 "3." 처럼 아직 숫자가 아닌 텍스트에 대해
  // value로 빈 문자열을 돌려준다. 그 0을 저장해 버리면 소수점을 찍는 순간 화면이 0으로
  // 덮여, 3.5를 칠 방법이 아예 없어진다.
  test('소수점을 찍는 중간 상태에서 값이 0으로 덮이지 않는다', () => {
    render(<StatefulNumberField />);
    const input = screen.getByLabelText('연 총수익률');

    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.change(input, { target: { value: '3.' } });

    expect(saved()).toBe('3');
    expect(input).not.toHaveValue(0);

    fireEvent.change(input, { target: { value: '3.5' } });

    expect(saved()).toBe('3.5');
    expect(input).toHaveValue(3.5);
  });

  test('값을 지우면 화면은 비고 저장된 값은 그대로다', () => {
    render(<StatefulNumberField initial={5} />);
    const input = screen.getByLabelText('연 총수익률');

    fireEvent.change(input, { target: { value: '' } });

    expect(input).toHaveValue(null);
    expect(saved()).toBe('5');
  });

  test('비운 채로 포커스를 잃으면 저장된 값으로 되돌아간다', () => {
    render(<StatefulNumberField initial={5} />);
    const input = screen.getByLabelText('연 총수익률');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(input).toHaveValue(5);
  });
});

describe('AmountField', () => {
  test('콤마를 뗀 숫자로 저장하고 콤마 표기로 보여 준다', () => {
    render(<StatefulAmountField />);
    const input = screen.getByLabelText('현재 잔액');

    fireEvent.change(input, { target: { value: '1234567' } });

    expect(saved()).toBe('1234567');
    // 타이핑 중에도 콤마 표기를 유지한다(기존 동작).
    expect(input).toHaveValue('1,234,567');
  });

  // 0을 곧바로 화면에 되돌려 그리면 «0»이 눌어붙어 지울 수 없다. 저장은 0으로 하되
  // 화면은 빈 칸으로 남아야 이어서 새 금액을 칠 수 있다.
  test('금액을 지우면 0으로 저장하되 화면은 빈 칸으로 남는다', () => {
    render(<StatefulAmountField />);
    const input = screen.getByLabelText('현재 잔액');

    fireEvent.change(input, { target: { value: '' } });

    expect(saved()).toBe('0');
    expect(input).toHaveValue('');

    fireEvent.change(input, { target: { value: '500' } });

    expect(saved()).toBe('500');
    expect(input).toHaveValue('500');
  });

  // 콤마를 직접 그리느라 type="text"를 쓰지만 사용자가 치는 것은 숫자다. inputMode가 없으면
  // 모바일에서 글자 자판이 올라오고, 그 자판이 붙이는 자동수정이 타이핑 중인 값을 건드린다.
  test('모바일에서 숫자 자판이 올라오도록 inputMode를 준다', () => {
    render(<StatefulAmountField />);

    expect(screen.getByLabelText('현재 잔액')).toHaveAttribute('inputmode', 'decimal');
  });

  test('숫자가 아닌 값은 저장하지 않는다', () => {
    render(<StatefulAmountField />);

    fireEvent.change(screen.getByLabelText('현재 잔액'), { target: { value: '12만원' } });

    expect(saved()).toBe('1000');
  });

  test('소수 자리수를 지정하면 그대로 보여 준다', () => {
    render(
      <AmountField
        label="현재 단가" value={1234.567} maximumFractionDigits={2} onChangeValue={vi.fn()}
      />
    );

    expect(screen.getByLabelText('현재 단가')).toHaveValue('1,234.57');
  });

  // 스테퍼는 입력을 거치지 않고 값을 바꾼다. 초안이 남아 있으면 방금 친 텍스트가 계속
  // 보여서 스테퍼가 먹지 않는 것처럼 읽힌다.
  test('스테퍼로 값을 바꾸면 타이핑 중이던 초안을 버린다', () => {
    const Harness = () => {
      const [value, setValue] = useState(1000);
      return (
        <AmountField
          label="현재 잔액" value={value} onChangeValue={setValue}
          onStepUp={() => setValue((v) => v + 10000)}
          onStepDown={() => setValue((v) => v - 10000)}
        />
      );
    };
    render(<Harness />);
    const input = screen.getByLabelText('현재 잔액');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Increase value' }));

    expect(input).toHaveValue('10,000');
  });
});

describe('파싱 규약', () => {
  test.each([
    ['', null],
    ['   ', null],
    ['3.5', 3.5],
    ['-2', -2],
    ['0', 0],
  ])('parseNumericInput(%o) === %o', (raw, expected) => {
    expect(parseNumericInput(raw as string)).toBe(expected);
  });

  test.each([
    ['', 0],
    ['1,234', 1234],
    ['12만원', null],
    ['Infinity', null],
  ])('parseAmountInput(%o) === %o', (raw, expected) => {
    expect(parseAmountInput(raw as string)).toBe(expected);
  });
});

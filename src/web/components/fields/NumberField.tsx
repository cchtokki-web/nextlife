'use client';

import React from 'react';
import InputField from '../InputField';
import { parseNumericInput, useNumericDraft } from './numericDraft';

interface NumberFieldProps extends Omit<
  React.ComponentProps<typeof InputField>,
  'value' | 'onChange' | 'type'
> {
  value: number;
  /** 저장값은 유지하되, 입력창에 표시할 최대 소수 자릿수. */
  maximumFractionDigits?: number;
  /** 저장해도 되는 숫자가 만들어졌을 때만 호출된다(빈 칸·미완성 소수는 호출하지 않는다). */
  onChangeValue: (value: number) => void;
}

/**
 * 숫자 입력 필드(수익률·배당률·수량·기간 등).
 *
 * `Number(e.target.value)`를 직접 쓰면 소수점을 찍는 순간 값이 0으로 덮인다 —
 * 자세한 사정은 numericDraft.ts 주석 참고.
 */
export function NumberField({
  value,
  maximumFractionDigits,
  onChangeValue,
  onBlur,
  ...rest
}: NumberFieldProps) {
  const draft = useNumericDraft({
    value,
    format: (current) => maximumFractionDigits === undefined
      ? String(current)
      : current.toLocaleString('en-US', {
        useGrouping: false,
        maximumFractionDigits,
      }),
    parse: parseNumericInput,
    onCommit: onChangeValue,
  });

  return (
    <InputField
      {...rest}
      type="number"
      value={draft.value}
      onChange={draft.onChange}
      onBlur={(event) => {
        draft.onBlur();
        onBlur?.(event);
      }}
    />
  );
}

export default NumberField;

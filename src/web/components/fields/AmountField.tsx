'use client';

import React from 'react';
import InputField from '../InputField';
import { parseAmountInput, useNumericDraft } from './numericDraft';

interface AmountFieldProps extends Omit<
  React.ComponentProps<typeof InputField>,
  'value' | 'onChange' | 'type'
> {
  value: number;
  /** 콤마를 뗀 숫자로 호출된다. 빈 칸은 0으로 온다. */
  onChangeValue: (value: number) => void;
  /** 단가처럼 소수 자리를 보여 줘야 하는 금액에만 준다. */
  maximumFractionDigits?: number;
}

/**
 * 금액 입력 필드. 저장된 값은 콤마 표기로 보여 주고, 입력은 콤마를 떼고 읽는다.
 *
 * 빈 칸을 곧바로 0으로 되돌려 그리면 필드에 «0»이 눌어붙어 지울 수 없게 된다.
 * 저장은 기존 계약대로 0으로 하되(parseAmountInput), 화면은 초안이 지킨다.
 */
export function AmountField({
  value, onChangeValue, maximumFractionDigits, onBlur, onStepUp, onStepDown, ...rest
}: AmountFieldProps) {
  const format = (amount: number) => amount.toLocaleString(
    undefined,
    maximumFractionDigits === undefined ? undefined : { maximumFractionDigits }
  );

  const draft = useNumericDraft({
    value,
    format,
    parse: parseAmountInput,
    onCommit: onChangeValue,
    // 타이핑 중에도 콤마를 보여 준다. 다만 콤마를 붙일 수 있는 «완성된 정수»일 때만이다 —
    // 빈 칸이나 소수점을 막 찍은 상태까지 숫자로 되그리면 지운 자리에 0이 돌아온다.
    formatDraft: (raw) => {
      if (!/^-?[\d,]+$/.test(raw)) return raw;
      const parsed = parseAmountInput(raw);
      return parsed === null ? raw : format(parsed);
    },
  });

  // 스테퍼는 입력을 거치지 않고 값을 바꾼다. 초안을 남겨 두면 방금 친 텍스트가 계속
  // 보여서 스테퍼가 «먹지 않는» 것처럼 읽힌다.
  const steppedBy = (handler?: () => void) => handler && (() => {
    draft.reset();
    handler();
  });

  return (
    <InputField
      {...rest}
      type="text"
      // 콤마를 직접 그려야 해서 type="text"를 쓰지만, 사용자가 치는 것은 숫자다. inputMode가
      // 없으면 모바일에서 글자 자판이 올라와 숫자를 치기도 어렵고, 자동수정이 값을 건드린다.
      inputMode="decimal"
      value={draft.value}
      onChange={draft.onChange}
      onBlur={(event) => {
        draft.onBlur();
        onBlur?.(event);
      }}
      onStepUp={steppedBy(onStepUp)}
      onStepDown={steppedBy(onStepDown)}
    />
  );
}

export default AmountField;

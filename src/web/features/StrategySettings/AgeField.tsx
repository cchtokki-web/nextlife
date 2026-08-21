'use client';

import React from 'react';
import InputField from '../../components/InputField';
import { useNumericDraft } from '../../components/fields/numericDraft';
import { AGE_MAX, AGE_MIN, parseAge } from './ageInput';

interface AgeFieldProps extends Omit<
  React.ComponentProps<typeof InputField>,
  'value' | 'onChange' | 'type' | 'min' | 'max'
> {
  /** 저장된 나이. 편집 중이 아닐 때 화면에 보이는 값이다. */
  value: number;
  /** 상한. 기대수명처럼 사람 나이보다 높은 상한을 쓰는 필드가 있다. */
  max?: number;
  /** 저장해도 되는 나이가 만들어졌을 때만 호출된다(빈 칸·잘못된 입력은 호출하지 않는다). */
  onChangeAge: (age: number) => void;
}

/**
 * 나이 입력 필드.
 *
 * parseAge는 빈 칸을 «저장하지 않는다»(0이 디바운스 자동저장으로 영구화되는 것을 막는다).
 * 저장을 건너뛰기만 하면 이번엔 필드를 «비울 수 없게» 되므로, 화면에 보일 텍스트는
 * useNumericDraft가 쥔다 — 사정은 numericDraft.ts 주석 참고.
 */
export function AgeField({ value, max = AGE_MAX, onChangeAge, onBlur, ...rest }: AgeFieldProps) {
  const draft = useNumericDraft({
    value,
    format: (age) => String(age),
    parse: (raw) => parseAge(raw, max),
    onCommit: onChangeAge,
  });

  return (
    <InputField
      {...rest}
      type="number"
      min={AGE_MIN}
      max={max}
      value={draft.value}
      onChange={draft.onChange}
      onBlur={(event) => {
        draft.onBlur();
        onBlur?.(event);
      }}
    />
  );
}

export default AgeField;

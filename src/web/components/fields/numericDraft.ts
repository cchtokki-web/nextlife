'use client';

import { useState, type ChangeEvent } from 'react';

/**
 * 숫자 입력이 «타이핑 중간 상태»를 잃지 않게 해 주는 초안(draft).
 *
 * 제어 입력에서 숫자 상태를 그대로 화면에 되돌려 주면, 사용자가 만들 수 있는 텍스트 중
 * «아직 숫자가 아닌» 것들이 전부 지워진다. 브라우저가 만드는 그 중간 상태는 두 가지다.
 *
 *  1. 빈 칸. 값을 지우는 순간 저장을 건너뛰면(0 저장을 막으려고) 다음 렌더가 옛 값을
 *     되돌려 놓아, 필드를 «비울 수 없게» 된다. 한 자리 값에서는 뒤에 덧붙이는 것 말고
 *     어떤 편집도 못 한다.
 *  2. 미완성 소수. `<input type="number">`는 "2." 나 "-"처럼 아직 숫자가 아닌 텍스트에
 *     대해 `value`로 빈 문자열을 돌려준다. 이때 Number('')의 0을 그대로 저장하면 화면이
 *     0으로 덮어써져, 소수점을 «찍는 순간» 입력이 날아간다 — 2.5를 칠 방법이 없다.
 *
 * 그래서 화면에 보일 텍스트는 초안이 쥐고, 저장은 parse가 값을 돌려줄 때만 한다.
 * 포커스를 잃으면 초안을 버려 화면이 다시 저장된 값을 따르게 한다(중간 상태가 남아
 * 화면과 계산 값이 어긋난 채로 굳지 않도록).
 */
export interface NumericDraft {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  /** 입력을 거치지 않고 값을 바꾸는 경로(스테퍼 등)에서 초안을 버린다. */
  reset: () => void;
}

export interface NumericDraftOptions<T> {
  /** 저장된 값. 편집 중이 아닐 때 화면에 보이는 값이다. */
  value: T;
  format: (value: T) => string;
  /** 저장하면 안 되는 중간 상태면 null을 돌려준다. */
  parse: (raw: string) => T | null;
  onCommit: (value: T) => void;
  /**
   * 초안을 화면에 그릴 때 손질한다(예: 금액의 콤마). 기본은 사용자가 친 그대로 두는 것이다.
   * 저장된 값을 거쳐 되그리면 «지운 상태»가 0으로 돌아오므로, 손질은 반드시 원문에서 한다.
   */
  formatDraft?: (raw: string) => string;
}

export function useNumericDraft<T>({
  value, format, parse, onCommit, formatDraft,
}: NumericDraftOptions<T>): NumericDraft {
  // null이면 초안 없음 = 저장된 값을 그대로 보여 준다.
  const [draft, setDraft] = useState<string | null>(null);

  return {
    value: draft === null ? format(value) : formatDraft ? formatDraft(draft) : draft,
    onChange: (event) => {
      const raw = event.target.value;
      setDraft(raw);
      const parsed = parse(raw);
      if (parsed !== null) onCommit(parsed);
    },
    onBlur: () => setDraft(null),
    reset: () => setDraft(null),
  };
}

/**
 * `type="number"` 필드의 파싱 규약.
 *
 * 빈 값은 저장하지 않는다. 이 자리에는 «지운 상태»와 «소수점을 막 찍은 상태»가 함께
 * 오는데(위 주석 2번), Number('')의 0을 저장하면 두 경우 모두 화면이 0으로 덮인다.
 * 저장을 건너뛰면 마지막으로 유효했던 값이 그대로 남으므로 계산도 흔들리지 않는다.
 */
export function parseNumericInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * 콤마 금액 필드의 파싱 규약.
 *
 * 나이·수익률과 달리 빈 값을 0으로 «저장»한다 — 금액 0은 실제로 의미가 있고, 지웠다
 * 다시 입력하는 경로가 기존 계약이다. 화면까지 0으로 되돌리지 않는 것은 초안이 맡는다.
 * Number.isFinite로 거르므로 '12만원'(NaN)이나 'Infinity'는 저장되지 않는다.
 */
export function parseAmountInput(raw: string): number | null {
  const normalized = raw.replace(/,/g, '');
  if (normalized.trim() === '') return 0;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

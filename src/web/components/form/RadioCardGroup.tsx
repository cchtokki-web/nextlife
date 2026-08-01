'use client';

import { type ReactNode } from 'react';

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  description: string; // 2줄 이하
  icon?: ReactNode;
  recommended?: boolean;
}

interface RadioCardGroupProps<T extends string> {
  name: string;
  value: T;
  options: ReadonlyArray<RadioCardOption<T>>;
  onChange: (value: T) => void;
  columns?: 1 | 2;
  // 그룹의 접근성 이름. 한 화면에 같은 라벨('AI 추천' 등)을 가진 그룹이 둘 이상
  // 있을 수 있으므로, 그룹 단위로 좁혀 찾을 수 있도록 반드시 지정한다.
  ariaLabel?: string;
}

// 아이콘 + 라벨 + 2줄 설명을 담은 카드형 라디오. 중요도가 높은 전략 선택은
// SelectField 대신 이 컴포넌트를 쓴다 — 선택지마다 "왜 이걸 고르는가"를
// 함께 보여줘야 사용자가 전략을 설계한다는 감각을 갖기 때문이다.
export function RadioCardGroup<T extends string>({
  name, value, options, onChange, columns = 1, ariaLabel,
}: RadioCardGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`grid gap-2 ${columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-2 ${
              selected
                ? 'border-primary bg-primary/10'
                : 'border-card-border hover:border-primary/50'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            {opt.icon && (
              <span className={`mt-0.5 shrink-0 ${selected ? 'text-primary' : 'text-foreground-muted'}`} aria-hidden="true">
                {opt.icon}
              </span>
            )}
            <span className="flex flex-col gap-0.5">
              <span className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-foreground'}`}>
                {opt.label}
                {opt.recommended && <span className="ml-1 text-xs font-normal">⭐ 추천</span>}
              </span>
              <span className="text-xs leading-snug text-foreground-muted">{opt.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

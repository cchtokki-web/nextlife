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
    // 2열 전환 기준을 뷰포트(sm:)가 아니라 이 그룹이 놓인 자리의 폭으로 잡는다.
    //
    // 전략 설정 패널은 화면이 아무리 넓어도 360px 고정이라, 뷰포트 기준으로는 항상
    // 2열이 되면서 카드 폭이 128px까지 눌렸다. 좌우 여백과 아이콘이 88px를 쓰므로
    // 글자에 남는 폭이 40px뿐이라 설명이 최대 13줄로 접혔다.
    //
    // 임계값 @xl(36rem = 576px)은 "2열이어도 각 열이 1열일 때만큼 읽힌다"를 기준으로
    // 잡았다. 한 열에 필요한 폭이 약 268px이라 두 열 + 간격이 그 아래로는 안 내려간다.
    <div className="@container">
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className={`grid gap-2.5 sm:gap-3 ${columns === 2 ? 'grid-cols-1 @xl:grid-cols-2' : 'grid-cols-1'}`}
      >
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-3 sm:gap-3.5 rounded-xl border pl-7 pr-5 py-3.5 sm:pl-8 sm:pr-6 sm:py-4 transition-all duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-2 ${
                selected
                  ? 'border-primary bg-[rgba(59,130,246,0.15)] shadow-sm'
                  : 'border-card-border bg-[rgba(0,0,0,0.2)] hover:bg-[rgba(255,255,255,0.05)] hover:border-card-border/80'
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
                <span className={`shrink-0 ${selected ? 'text-primary' : 'text-foreground-muted'}`} aria-hidden="true">
                  {opt.icon}
                </span>
              )}
              <span className="flex flex-col gap-0.5 sm:gap-1 min-w-0 flex-1">
                <span className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${selected ? 'text-primary' : 'text-foreground'}`}>
                  {/* 좁은 칸에서 제목이 글자 단위로 쪼개지지 않게 한다(한국어는 단어 경계가
                      드물어 break-word가 아니어도 어절 중간에서 접힌다). */}
                  <span className="break-keep">{opt.label}</span>
                  {opt.recommended && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                      권장
                    </span>
                  )}
                </span>
                <span className="text-xs leading-relaxed text-foreground-muted break-keep">{opt.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import { useId, useState, type ReactNode } from 'react';

interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();

  const show = () => setVisible(true);
  const hide = () => setVisible(false);

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      <span tabIndex={0} onFocus={show} onBlur={hide} aria-describedby={visible ? tooltipId : undefined}>
        {children}
      </span>
      {visible && (
        <span
          id={tooltipId}
          role="tooltip"
          // w-max(width: max-content)가 핵심이다. 절대 배치된 요소의 폭은 기본적으로
          // 위치 기준 조상(여기서는 14px짜리 아이콘 래퍼)에 맞춰 줄어드는데, 줄바꿈이
          // 허용되면 그 최소 폭이 "가장 긴 단어"까지 내려간다. 한국어 설명문은 단어 경계가
          // 없다시피 해서 한 줄에 한 글자씩 세로로 늘어지는 상자가 됐다.
          // max-content로 폭을 내용에 맞춘 뒤 max-w-xs에서만 줄을 바꾼다.
          //
          // 가로 기준을 트리거 중앙이 아니라 왼쪽 끝(left-0)에 두는 이유: 이 툴팁을 쓰는
          // 설정 패널은 화면 왼쪽에 붙어 있어서, 중앙 정렬하면 폭의 절반이 뷰포트 밖으로
          // 나간다(1280px 화면에서 최대 -58px까지 잘렸다). 오른쪽으로 펼치면 넓은 결과
          // 영역 위로 겹칠 뿐 잘리지 않는다.
          className="absolute bottom-full left-0 z-10 mb-2 w-max max-w-xs whitespace-normal rounded-md border border-card-border bg-background px-2 py-1 text-xs leading-relaxed text-foreground shadow-lg"
        >
          {label}
        </span>
      )}
    </span>
  );
}

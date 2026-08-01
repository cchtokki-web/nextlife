'use client';

import { HelpCircle } from 'lucide-react';
import { GLOSSARY, GlossaryTerm, Tooltip } from '../ui';

interface HelpTipProps {
  // 용어집에 등재된 키. text보다 우선한다.
  term?: GlossaryTerm;
  // 용어집에 없는 임시 설명문. 2줄 이하로 쓴다.
  text?: string;
}

// 설정 항목 옆의 "?" 도움말. 세법 용어처럼 화면에 그대로 노출하면 안 되는 표현은
// 전부 이 컴포넌트 뒤로 보낸다.
export function HelpTip({ term, text }: HelpTipProps) {
  const label = term ? GLOSSARY[term] : text;
  if (!label) return null;

  return (
    // 폭·줄바꿈은 Tooltip이 정한다. 예전에는 여기서 max-w-xs를 걸었는데, 그 값이
    // 붙는 안쪽 span이 아니라 바깥 툴팁 상자의 폭이 문제라 아무 효과가 없었다.
    <Tooltip label={label}>
      <HelpCircle size={14} className="text-foreground-muted" aria-label="도움말" />
    </Tooltip>
  );
}

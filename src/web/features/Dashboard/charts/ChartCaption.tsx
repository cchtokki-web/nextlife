import { Sparkles } from 'lucide-react';

interface ChartCaptionProps {
  children: string;
}

// 차트 상단에 붙는 한 줄 AI(rule-based) 요약. generateChartCaptions usecase가 생성한 문자열을
// 그대로 표시만 하는 얇은 프레젠테이션 컴포넌트.
export function ChartCaption({ children }: ChartCaptionProps) {
  return (
    <p className="mb-3 flex items-center gap-1.5 text-sm text-foreground-muted">
      <Sparkles size={14} className="shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

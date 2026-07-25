import { ExecutionRoadmap as ExecutionRoadmapData } from '../../../../core/usecases/dashboard/computeExecutionRoadmap';
import GlassCard from '../../../components/GlassCard';

interface ExecutionRoadmapProps {
  roadmap: ExecutionRoadmapData;
}

// AI 추천(또는 현재 설정 폴백) 계획 기준으로 "언제 무슨 일이 일어나는지"를 수직 타임라인으로
// 보여준다. RecommendationChecklist("무엇을")와 짝을 이루며, Before/After 토글과는 무관하게
// 항상 고정된 기준(계산은 컴포넌트 밖 computeExecutionRoadmap)으로 렌더링만 담당한다.
export function ExecutionRoadmap({ roadmap }: ExecutionRoadmapProps) {
  return (
    <GlassCard className="mb-6">
      <h3 className="mb-1 text-base font-semibold">실행 로드맵</h3>
      <p className="mb-3 text-xs text-foreground-muted">AI 추천 전략 기준 — 나이별로 무엇이 바뀌는지 보여줍니다.</p>
      <div className="flex flex-col">
        {roadmap.events.map((event) => {
          const hasWarning = event.items.some((item) => item.severity === 'warning');
          return (
            <div key={event.age} className="flex gap-3">
              <div className="flex flex-col items-center">
                {/* text-sm의 기본 line-height(1.25rem)와 dot 크기(h-3=0.75rem)의 차이를 절반씩
                    나눠(mt-1=0.25rem) 옆 텍스트의 첫 줄 중앙에 dot을 맞춘다. */}
                <span
                  data-marker="filled"
                  className={`mt-1 h-3 w-3 shrink-0 rounded-full ${hasWarning ? 'bg-danger' : 'bg-primary'}`}
                />
                <span className="w-px flex-1 bg-foreground/15" />
              </div>
              <div className="pb-6">
                <p className="text-sm font-semibold">{event.age}세</p>
                {event.items.map((item) => (
                  <div key={item.title} className="mt-1">
                    <p className={`text-sm font-medium ${item.severity === 'warning' ? 'text-danger' : ''}`}>{item.title}</p>
                    <p className="text-xs text-foreground-muted">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <div className="flex gap-3">
          <span data-marker="hollow" className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-foreground/40" />
          <p className="text-sm font-semibold text-foreground-muted">{roadmap.expectancy}세 기대수명</p>
        </div>
      </div>
    </GlassCard>
  );
}

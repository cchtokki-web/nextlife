import { ExecutionRoadmap as ExecutionRoadmapData } from '../../../../core/usecases/dashboard/computeExecutionRoadmap';
import GlassCard from '../../../components/GlassCard';

interface ExecutionRoadmapProps {
  roadmap: ExecutionRoadmapData;
  // 지금 그려진 로드맵이 추천안 기준인가. Before/After 토글을 따라간다 — 예전에는 토글과
  // 무관하게 항상 추천안을 그려서, 추천을 적용하지 않은 화면에서 KPI·차트는 현재 설정을
  // 보여주는데 로드맵만 다른 기준을 말했다.
  isRecommendedPlan?: boolean;
}

// "언제 무슨 일이 일어나는지"를 수직 타임라인으로 보여준다. RecommendationChecklist("무엇을")와
// 짝을 이루며, 계산은 컴포넌트 밖(computeExecutionRoadmap)에서 하고 여기서는 렌더링만 담당한다.
export function ExecutionRoadmap({ roadmap, isRecommendedPlan = false }: ExecutionRoadmapProps) {
  return (
    <GlassCard>
      <h3 className="mb-1 text-base font-semibold">실행 로드맵</h3>
      <p className="mb-3 text-xs text-foreground-muted">
        {isRecommendedPlan
          ? 'AI 추천 전략 기준 — 나이별로 무엇이 바뀌는지 보여줍니다.'
          : '현재 설정 기준 — 나이별로 무엇이 일어나는지 보여줍니다.'}
      </p>
      <div className="flex flex-col">
        {roadmap.events.map((event) => {
          const hasWarning = event.items.some((item) => item.severity === 'warning');
          return (
            <div key={event.age} className="flex gap-3">
              <div className="flex flex-col items-center">
                {/* dot을 margin 값으로 눈대중 맞추면 폰트/브라우저에 따라 어긋난다. 대신 옆
                    텍스트와 정확히 같은 높이(h-5=leading-5=1.25rem)의 박스를 만들고 그 안에서
                    flex items-center로 중앙 정렬하면, 두 박스의 세로 중심이 항상 일치한다. */}
                <span className="flex h-5 w-3 shrink-0 items-center justify-center">
                  <span
                    data-marker="filled"
                    className={`h-3 w-3 rounded-full ${hasWarning ? 'bg-danger' : 'bg-primary'}`}
                  />
                </span>
                <span className="w-px flex-1 bg-foreground/15" />
              </div>
              <div className="pb-6">
                <p className="text-sm font-semibold leading-5">{event.age}세</p>
                {event.items.map((item) => (
                  <div key={item.title} className="mt-1">
                    <p className={`text-sm font-medium ${item.severity === 'warning' ? 'text-danger' : ''}`}>
                      {item.title}
                      {/* 추천이 옮긴 나이임을 그 자리에서 밝힌다. 없으면 추천이 건드리지 않는
                          항목(배우자 국민연금 등)과 섞여 "왜 이 순서지?"가 된다. */}
                      {item.changedFromAge !== undefined && (
                        <span className="ml-2 rounded-full border border-primary/40 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          현재 {item.changedFromAge}세 → 추천 {event.age}세
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-foreground-muted">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <div className="flex gap-3">
          <span className="flex h-5 w-3 shrink-0 items-center justify-center">
            <span data-marker="hollow" className="h-3 w-3 rounded-full border-2 border-foreground/40" />
          </span>
          <p className="text-sm font-semibold leading-5 text-foreground-muted">
            {roadmap.endAge}세 {roadmap.endLabel}
          </p>
        </div>
      </div>
    </GlassCard>
  );
}

import { Check, Sparkles } from 'lucide-react';

interface AiHintBadgeProps {
  // 표시 문자열(예: "70세부터 수령").
  hint: string;
  // 이 값이 지금 계산에 실제로 들어가 있는지.
  applied: boolean;
}

// AI가 제안했거나 이미 적용한 값을 알리는 배지.
//
// 두 상태는 성격이 다르다 — '적용'은 "지금 돌아간 계산의 사실"이고 '추천'은 "아직 반영되지
// 않은 제안"이다. 예전에는 색·테두리·배경이 모두 같아 접두어 글자 하나로만 갈렸고, 스캔으로는
// 구분되지 않았다(색맹 사용자에게는 단서가 사실상 없었다).
//
// 구분은 색이 아니라 모양으로 준다:
//   적용 — 실선 테두리 + 체크 아이콘. 확정된 사실.
//   추천 — 점선 테두리 + Sparkles 아이콘. 아직 제안.
//
// 채운 배경(solid)은 쓰지 않는다. 이 저장소에서 채운 배경은 이미 "누를 수 있는 것"을 뜻한다
// (SettingSection의 AI 추천 버튼). 배지가 그 옷을 입으면 나란히 놓였을 때 액션과 정보가
// 구분되지 않는다.
export function AiHintBadge({ hint, applied }: AiHintBadgeProps) {
  const Icon = applied ? Check : Sparkles;

  return (
    <span
      // 테스트와 디버깅이 Tailwind 클래스가 아니라 이 값을 보게 한다. 클래스를 단언하면
      // 스타일을 손볼 때마다 동작 변화 없이 깨진다.
      data-ai-badge={applied ? 'applied' : 'suggested'}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        applied
          ? 'border border-primary/60 bg-primary/15 text-primary'
          : 'border border-dashed border-primary/35 bg-transparent text-primary/75'
      }`}
    >
      {/* 아이콘은 장식이다. 접두어 문구가 이미 '적용'/'추천'을 말하므로 중복 낭독을 막는다. */}
      <Icon size={11} aria-hidden="true" />
      {applied ? 'AI 적용' : 'AI 추천'}: {hint}
    </span>
  );
}

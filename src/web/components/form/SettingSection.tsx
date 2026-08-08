'use client';

import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Sparkles } from 'lucide-react';

interface SettingSectionProps {
  icon: ReactNode;
  title: string;
  // 이 섹션에서 지금 모드에 보이고 되돌릴 수 있는 변경 개수. 숨은 값의 존재는 패널 상단
  // 요약이 따로 책임진다 — 여기서 합치면 펼쳐도 찾을 수 없는 개수를 배지가 말하게 된다.
  changedCount?: number;
  defaultOpen?: boolean;
  // 방금 값이 바뀐 섹션이면 true. 테두리를 잠깐 강조해 "무엇이 결과를 바꿨는지"를 알린다.
  highlighted?: boolean;
  onAiRecommend?: () => void;
  aiDisabled?: boolean;
  aiLabel?: string;
  children: ReactNode;
}

// 6개 전략 섹션이 공유하는 아코디언 셸.
// ui/Collapse를 쓰지 않는 이유: 헤더 안에 별도 클릭 대상(AI 추천 버튼)이 필요한데
// Collapse는 헤더 전체가 하나의 <button>이라 버튼 중첩이 된다.
export function SettingSection({
  icon, title, changedCount = 0,
  defaultOpen = false, highlighted = false,
  onAiRecommend, aiDisabled = false, aiLabel = '추천값 반영', children,
}: SettingSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  // 펼침 애니메이션이 끝났는지. 끝난 뒤에는 본문의 overflow 잘라내기를 푼다(툴팁이
  // 섹션 밖으로 나갈 수 있어야 한다). 아래 motion.div의 className에서 쓴다.
  //
  // 초기값이 defaultOpen인 이유: 이미 펼쳐진 채로 마운트되면 AnimatePresence의
  // initial={false} 때문에 진입 애니메이션이 아예 없고, 그러면 onAnimationComplete도
  // 오지 않아 영영 잘라낸 상태로 남는다(전문가 모드로 올릴 때의 「고급 설정」이 그랬다).
  const [isSettled, setIsSettled] = useState(defaultOpen);
  const contentId = useId();
  const accessibleAiLabel = aiLabel.startsWith('추천값') ? '추천값 반영' : aiLabel;

  // defaultOpen이 바뀌면 열림 상태를 따라간다.
  //
  // useState(defaultOpen)은 초기값만 읽는다. 호출부(StrategySettingsPanel)는 고급 설정에
  // defaultOpen={mode === 'expert'}를 주면서 key를 id로 고정하므로 리마운트가 없고,
  // 기본 모드가 'simple'이라 마운트 시 false로 굳어 이후 전문가 모드로 올려도 영영 열리지
  // 않았다 — 죽은 조건이었다.
  //
  // 이펙트가 아니라 "prop이 바뀔 때 렌더 중 상태 조정" 패턴을 쓴다(React 공식 권장).
  // 이펙트로 하면 커밋이 한 번 더 발생해 열림 애니메이션이 한 프레임 늦게 시작한다.
  // defaultOpen이 그대로인 리렌더에서는 아무것도 하지 않으므로 사용자가 직접 접은
  // 상태는 유지된다.
  const [prevDefaultOpen, setPrevDefaultOpen] = useState(defaultOpen);
  if (prevDefaultOpen !== defaultOpen) {
    setPrevDefaultOpen(defaultOpen);
    setIsOpen(defaultOpen);
  }

  return (
    <div
      data-highlighted={highlighted || undefined}
      // 강조는 테두리 색만 바꾼다. 예전에는 배경까지 파랗게 채웠는데, 카드 전체가
      // 단색으로 덮여 "이 영역이 선택됐다"로 읽혔다. 배경은 어느 쪽이든 같은 값을 쓴다.
      //
      // 전환 시간(150ms)은 강조 지속 시간(HIGHLIGHT_DURATION_MS = 800ms)보다 충분히
      // 짧아야 한다. 길면 켜지다 말고 바로 꺼져서 무슨 일이 일어났는지 안 보인다.
      className={`rounded-2xl border bg-[rgba(0,0,0,0.2)] transition-colors duration-150 ${
        highlighted ? 'border-primary' : 'border-card-border hover:border-card-border/80'
      }`}
    >
      <div className="px-4 sm:px-5">
        <div className="flex items-center gap-3">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={() => setIsOpen((v) => !v)}
          className="flex min-w-0 shrink items-center gap-2.5 py-4 text-left"
        >
          <span className="shrink-0 text-primary" aria-hidden="true">{icon}</span>
          <span className="text-sm font-bold text-foreground break-keep">{title}</span>
        </button>

        {/*
          배지는 제목 오른쪽에, 토글 버튼 "밖"에 둔다.

          버튼 안에 넣으면 안 된다: 제목과 폭을 나눠 쓰다 제목이 밀려 내려가고, 세로 중앙
          정렬된 아이콘이 제목이 아니라 배지 옆에 붙는다(예전에 그렇게 깨졌다).

          이 컨테이너가 flex-1을 갖는 이유는 두 가지다. 배지가 제목 바로 옆에 붙게 하고
          (컨테이너 안에서 왼쪽 정렬), 동시에 남은 폭을 흡수해 AI 추천 버튼과 chevron을
          오른쪽 끝으로 밀어낸다. 배지가 없을 때도 렌더해야 그 밀어내기가 유지된다.

          예전에는 이 배지들이 제목 아래 별도 줄에 있었다. 그때는 헤더에 '이미 최적'
          비활성 버튼이 항상 떠 있어 제목에 돌아오는 자리가 135px뿐이었기 때문이다.
          그 버튼을 없애 자리가 생겼으므로 한 줄로 되돌린다.
        */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {changedCount > 0 && (
            <span className="rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary whitespace-nowrap">
              {changedCount}개 변경
            </span>
          )}
        </div>

        {onAiRecommend && (
          <button
            type="button"
            onClick={onAiRecommend}
            disabled={aiDisabled}
            // 화면에는 aiLabel("AI 추천")만 보이지만, 접근성 이름에는 섹션 제목을 덧붙인다.
            // 6개 섹션 중 셋(연금·투자 등)이 모두 같은 aiLabel을 쓰므로, 이 이름이 없으면
            // 스크린리더 사용자가 role+name으로 이동할 때 버튼을 구분할 수 없다.
            aria-label={`${title} ${accessibleAiLabel}`}
            // 크기는 왼쪽 '개 변경' 배지와 맞추되(px-2 py-0.5 text-[10px]), 색은 반대로 간다.
            //
            // 이 저장소에서 'primary 아웃라인 pill'은 이미 "정보"를 뜻한다 — 섹션의 '개 변경'
            // 배지, 필드의 '사용자 설정' 배지(ChangedBadge), AI 힌트 배지가 모두 같은 옷을
            // 입는다. 버튼이 그 옷을 함께 입으면 나란히 놓였을 때 누를 수 있는 것과 읽기만
            // 하는 것이 구분되지 않는다. 채운 배경으로 "이건 액션"임을 드러낸다.
            //
            // 테두리는 평소 transparent로 둔다. 비활성일 때만 색을 주면 1px만큼 크기가
            // 변하는데, 처음부터 자리를 잡아 두면 상태가 바뀌어도 헤더가 흔들리지 않는다.
            className="flex shrink-0 items-center gap-1 rounded-full border border-transparent bg-primary px-2 py-0.5 text-[10px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:border-card-border disabled:bg-transparent disabled:text-foreground-muted disabled:hover:opacity-100"
          >
            <Sparkles size={11} aria-hidden="true" />
            {aiLabel}
          </button>
        )}

        {/*
          chevron은 사용자 눈에 "펼치기 버튼"으로 보이므로 실제 클릭 대상이어야 한다.
          예전에는 토글 <button> 바깥의 형제 <span>이라 눌러도 아무 일도 없었다.

          접근성 트리에서는 감춘다(aria-hidden + tabIndex -1). 왼쪽 토글 버튼이
          이미 aria-expanded/aria-controls를 가진 정식 컨트롤이라, 여기서 이름을
          노출하면 같은 동작을 하는 컨트롤이 섹션마다 둘로 늘어난다.
          tabIndex가 -1이므로 포커스 순서에도 끼어들지 않는다.
        */}
        <button
          type="button"
          data-toggle-chevron
          onClick={() => setIsOpen((v) => !v)}
          aria-hidden="true"
          tabIndex={-1}
          className="shrink-0 cursor-pointer p-1 -m-1 text-primary"
        >
          <motion.span
            className="block"
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown size={16} />
          </motion.span>
        </button>
        </div>

      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={contentId}
            role="region"
            // 높이 애니메이션 동안에만 잘라낸다.
            //
            // overflow-hidden을 계속 걸어 두면 필드 옆 "?" 도움말 툴팁이 섹션 경계를
            // 넘는 순간 잘린다(첫 줄 필드는 툴팁이 위로 열려 헤더 쪽에서 잘렸다).
            // 애니메이션이 끝나면 높이가 auto라 잘라낼 것이 없으므로 풀어도 안전하다.
            className={`${isSettled ? '' : 'overflow-hidden'} border-t border-card-border/60`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onAnimationStart={() => setIsSettled(false)}
            onAnimationComplete={() => setIsSettled(true)}
          >
            <div className="flex flex-col gap-5 px-4 sm:px-5 py-4.5 sm:py-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

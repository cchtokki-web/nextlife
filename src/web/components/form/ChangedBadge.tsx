// 기본값과 다른 값임을 알리는 배지. FieldRow와 SwitchField가 같은 마크업을 쓰므로
// 한 곳으로 뽑아 두 컴포넌트가 서로 어긋나지 않게 한다.
export function ChangedBadge({ changed }: { changed?: boolean }) {
  if (!changed) return null;

  return (
    <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
      사용자 설정
    </span>
  );
}

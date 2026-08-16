import type { PrivatePension } from '../../../core/entities/types';

// PrivatePensionType 전체를 덮는다. 예전에는 irp/savings만 라벨링하고 나머지를 「기타」로
// 떨궜는데, 사용자는 입력 폼에서 「퇴직연금」을 고를 수 있어(AssetFormSection의 선택지)
// 화면은 「퇴직 연금 계좌」라 부르고 리포트만 「기타」라 부르는 상태였다.
const TYPE_LABELS: Record<string, string> = {
  irp: 'IRP',
  savings: '연금저축',
  retirement: '퇴직연금',
};

/**
 * 리포트에 인쇄할 사적연금 이름.
 *
 * `PrivatePension.name`은 선택 필드다(types.ts). 기본 시나리오의 사적연금에는 이름이 없어
 * PDF가 그 값을 그대로 인쇄하면 「undefined (IRP)」가 찍힌다 — 사용자가 내려받는 문서라
 * 눈에 띄는 결함이었다.
 *
 * 이름이 없을 때 「사적연금」 같은 군말을 넣는 대신 계좌 종류를 이름 자리에 올린다.
 * 이름이 있을 때 붙는 괄호와 중복되지 않고("IRP (IRP)"), 사용자가 실제로 아는 말이다.
 *
 * 빈 문자열도 없는 것으로 본다 — 입력 폼이 `pension.name || ''`로 빈 문자열을 저장하므로
 * undefined만 막으면 「 (IRP)」가 남는다.
 */
export function describePrivatePensionLabel(pension: PrivatePension): string {
  const typeLabel = TYPE_LABELS[pension.type] ?? '기타';
  const name = pension.name?.trim();
  return name ? `${name} (${typeLabel})` : typeLabel;
}

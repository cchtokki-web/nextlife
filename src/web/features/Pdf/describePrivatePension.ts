import type { PrivatePension, PrivatePensionType } from '../../../core/entities/types';

// **Record<PrivatePensionType, ...>이라 종류가 늘면 컴파일러가 누락을 잡는다.**
//
// 예전에는 Record<string, string>이었고 irp/savings만 채워져 있었다. 사용자는 입력 폼에서
// 「퇴직연금」을 고를 수 있는데(AssetFormSection의 선택지) 리포트만 그것을 「기타」라
// 불렀고, 타입이 느슨해 아무도 그 누락을 알려주지 않았다.
const TYPE_LABELS: Record<PrivatePensionType, string> = {
  irp: 'IRP',
  savings: '연금저축',
  retirement: '퇴직연금',
};

/**
 * 계좌 종류의 표시 이름.
 *
 * 위 표가 타입을 전부 덮는데도 `?? '기타'`를 남기는 이유: 이 값은 로컬스토리지와 DB에서
 * 온다(loadParams는 `userProfile`과 `assets` 배열 유무만 보고 타입을 검증하지 않는다).
 * 즉 저장된 옛 시나리오에는 지금 유니온에 없는 문자열이 들어 있을 수 있다. 컴파일러가
 * 보는 세계와 런타임이 받는 세계가 달라서, 둘 다 막아야 한다.
 */
function labelForType(type: PrivatePensionType): string {
  return TYPE_LABELS[type] ?? '기타';
}

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
  const typeLabel = labelForType(pension.type);
  const name = pension.name?.trim();
  return name ? `${name} (${typeLabel})` : typeLabel;
}

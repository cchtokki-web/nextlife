import type { IsaAccount, IsaAccountType } from '../../../core/entities/types';

// 종류가 늘면 컴파일러가 누락을 잡는다 — describePrivatePensionLabel의 TYPE_LABELS와 같은 이유.
// 예전에는 page.tsx 안의 인라인 삼항이라(`type === 'general' ? '일반형' : '서민형'`)
// 값이 늘면 새 종류가 조용히 「서민형」이 됐다.
const TYPE_LABELS: Record<IsaAccountType, string> = {
  general: '일반형',
  low_income: '서민형',
};

/**
 * 계좌 종류의 표시 이름.
 *
 * 표가 타입을 전부 덮는데도 `?? '기타'` 폴백을 남기는 이유는 저장된 옛 시나리오에 지금
 * 유니온에 없는 문자열이 들어 있을 수 있어서다(describePrivatePension의 labelForType 주석 참고).
 */
function labelForType(type: IsaAccountType): string {
  return TYPE_LABELS[type] ?? '기타';
}

/**
 * 리포트에 인쇄할 ISA 계좌 이름.
 *
 * 규칙은 describePrivatePensionLabel·describeInvestmentAssetLabel과 같다 —
 * 이름이 있으면 `이름 (종류)`, 없으면 종류만.
 *
 * 종전 인라인 코드는 이름이 없을 때 「ISA 계좌 (일반형)」이었다. 「ISA 계좌」라는 군말이
 * 괄호 안 종류와 겹쳐, 다른 두 자리와 같은 규칙으로 맞췄다.
 */
export function describeIsaAccountLabel(account: IsaAccount): string {
  const typeLabel = labelForType(account.type);
  const name = account.name?.trim();
  return name ? `${name} (${typeLabel})` : typeLabel;
}

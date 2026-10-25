import type { InvestmentAsset } from '../../../core/entities/types';

type InvestmentAssetType = InvestmentAsset['type'];

// 종류가 늘면 컴파일러가 누락을 잡는다 — describePrivatePensionLabel의 TYPE_LABELS와 같은 이유.
const TYPE_LABELS: Record<InvestmentAssetType, string> = {
  etf: 'ETF',
  stock: '개별주식',
};

/**
 * 자산 종류의 표시 이름.
 *
 * 표가 타입을 전부 덮는데도 `?? '기타'`를 남기는 이유는 저장된 옛 시나리오에 지금 유니온에
 * 없는 문자열이 들어 있을 수 있어서다(describePrivatePension의 labelForType 주석 참고).
 */
function labelForType(type: InvestmentAssetType): string {
  return TYPE_LABELS[type] ?? '기타';
}

/**
 * 리포트에 인쇄할 투자자산 이름.
 *
 * 예전에는 `${a.type}`을 그대로 찍어 「KODEX 200 (etf)」가 나왔다. 같은 문서에서 계좌 종류는
 * 한글로 부르는데(「IRP」·「일반형」) 투자자산만 원시 enum이라 표기 언어가 갈렸다.
 *
 * 규칙은 describePrivatePensionLabel과 같다 — 이름이 있으면 `이름 (종류)`, 없으면 종류만.
 * InvestmentAsset.name은 지금 필수 필드지만, 사적연금에서 선택 필드를 그대로 인쇄해
 * 「undefined (IRP)」가 찍힌 적이 있어 두 자리가 같은 규칙을 쓰게 둔다.
 */
export function describeInvestmentAssetLabel(asset: InvestmentAsset): string {
  const typeLabel = labelForType(asset.type);
  const name = asset.name?.trim();
  return name ? `${name} (${typeLabel})` : typeLabel;
}

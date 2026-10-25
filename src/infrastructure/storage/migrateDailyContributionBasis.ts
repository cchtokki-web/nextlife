/**
 * 「매일 적립」의 월 환산 기준이 달력일(365)에서 영업일(250)로 바뀐 것을 옛 저장본에 반영한다.
 *
 * 저장본은 1회 적립액(contributionAmount)과 월 환산액(monthlyContribution)을 함께 들고 있고,
 * 엔진이 읽는 것은 월 환산액뿐이다. 기준만 바꾸면 이미 저장된 「매일 1만 5천원」은 화면에서는
 * 1만 5천원 × 250일이라고 말하면서 계산에는 365일로 부풀린 월 45.6만원을 계속 쓴다. 사용자가
 * 그 칸을 다시 건드리기 전까지 화면과 계산이 어긋나므로, 읽는 시점에 다시 유도한다.
 *
 * **정제(normalizeSimulationParams)보다 «앞»에서 도는 이유**는 migrateLegacyReturnKeys와 같다 —
 * collectNormalizationIssues가 raw와 정제 결과를 비교하므로, 정제 안에서 값을 고치면 옛
 * 시나리오를 열 때마다 「금액이 대체됨」 경고가 뜬다.
 *
 * **1회 적립액을 진실로 본다.** 월 환산액은 거기서 파생된 캐시다. 그래서 몇 번을 적용해도
 * 같은 결과가 나오고, 스키마 버전 마커가 필요 없다.
 */
import {
  roundContributionForCurrency,
  toMonthlyContribution,
} from '../../core/domain/input/contributionPeriod';

export function migrateDailyContributionBasis(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const assets = raw.assets;
  if (!Array.isArray(assets)) return raw;

  let changed = false;
  const nextAssets = assets.map((asset) => {
    if (!isRecord(asset)) return asset;
    // 매주·매월은 계수가 그대로다. 손대면 반올림 잔차만 남는다.
    if (asset.contributionPeriod !== 'daily') return asset;

    const amount = asset.contributionAmount;
    // 1회 적립액이 없으면 무엇을 곱해야 하는지 알 수 없다. 월 환산액을 되나누면 오차가
    // 쌓이고 여러 번 적용할 때마다 값이 흔들리므로, 모르면 그대로 둔다.
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return asset;

    // 통화가 깨져 있으면 정제가 KRW로 되돌린다. 여기서도 같은 기본값을 쓴다.
    const monthly = roundContributionForCurrency(
      toMonthlyContribution(amount, 'daily'),
      asset.currency === 'USD' ? 'USD' : 'KRW'
    );
    if (asset.monthlyContribution === monthly) return asset;

    changed = true;
    return { ...asset, monthlyContribution: monthly };
  });

  return changed ? { ...raw, assets: nextAssets } : raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

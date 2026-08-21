/**
 * 적립 주기(매일/매주/매월)를 «월 적립액»으로 환산하는 단 하나의 자리.
 *
 * 시뮬레이션 엔진에는 언제나 monthlyContribution 하나만 들어간다. 주기는 입력 편의를 위한
 * 표현일 뿐이므로, 환산 계수가 두 곳에 흩어지면 화면과 저장본이 서로 다른 연 납입액을
 * 뜻하게 된다. 그 계수를 여기 한 곳에 둔다.
 */
import type { AssetCurrency, InvestmentAsset } from '../../entities/types';

export type ContributionPeriod = NonNullable<InvestmentAsset['contributionPeriod']>;

export const MONTHS_PER_YEAR = 12;

/**
 * 「매일 적립」이 뜻하는 1년의 적립 횟수 — 달력일이 아니라 «영업일»이다.
 *
 * 자동매수는 증시가 열리는 날에만 체결된다. 주말·공휴일을 빼면 한국·미국 증시 모두 연
 * 250일 언저리이고, 달력일 365로 세면 같은 「매일 1만 5천원」이 연 547만원 대 375만원으로
 * 46% 부풀려진다. 부풀려지는 쪽은 자산이므로, 그대로 두면 은퇴 준비가 실제보다 낙관적으로
 * 보인다.
 */
export const CONTRIBUTION_DAYS_PER_YEAR = 250;

/** 1년의 적립 주 수. 주간 자동매수는 휴장주가 사실상 없어 달력 그대로다. */
export const CONTRIBUTION_WEEKS_PER_YEAR = 52;

/** 한 달에 몇 번 적립하는가. 월 환산의 유일한 계수다. */
export function contributionsPerMonth(period: ContributionPeriod): number {
  if (period === 'daily') return CONTRIBUTION_DAYS_PER_YEAR / MONTHS_PER_YEAR;
  if (period === 'weekly') return CONTRIBUTION_WEEKS_PER_YEAR / MONTHS_PER_YEAR;
  return 1;
}

/** 주기별 1회 적립액 -> 월 적립액. 엔진이 읽는 monthlyContribution이 이 값이다. */
export function toMonthlyContribution(amount: number, period: ContributionPeriod): number {
  return amount * contributionsPerMonth(period);
}

/** 주기를 바꿀 때 「연 납입액이 같도록」 1회 적립액을 옮긴다. */
export function convertContributionAmount(
  amount: number,
  fromPeriod: ContributionPeriod,
  toPeriod: ContributionPeriod
): number {
  return toMonthlyContribution(amount, fromPeriod) / contributionsPerMonth(toPeriod);
}

/**
 * 금액 표시 단위에 맞춰 자른다. 원화는 원 단위, 외화는 센트 단위.
 *
 * 저장본을 만드는 곳(입력 폼)과 옛 저장본을 고치는 곳(마이그레이션)이 같은 규칙을 써야
 * 두 경로가 같은 숫자에 도달한다.
 */
export function roundContributionForCurrency(amount: number, currency: AssetCurrency): number {
  return currency === 'KRW' ? Math.round(amount) : Math.round(amount * 100) / 100;
}

import { roundToWon } from '../../entities/money';

export interface CashFlowIncome {
  employment: number;
  nationalPension: number;
  privatePension: number;
  dividend: number;
  other: number;
}

export interface FundingGapResult {
  targetSpending: number;
  availableIncome: number;
  fundingGap: number;
  surplus: number;
}

export interface CompletedCashFlow extends FundingGapResult {
  withdrawalNetCash: number;
  actualSpending: number;
  shortfall: number;
}

/**
 * Income is applied before any asset withdrawal. All amounts use the simulation's display
 * currency and the same nominal/real basis as the caller.
 */
export function calculateFundingGap(
  targetSpending: number,
  income: CashFlowIncome
): FundingGapResult {
  const safeTarget = Math.max(0, targetSpending);
  const availableIncome = Math.max(
    0,
    income.employment + income.nationalPension + income.privatePension + income.dividend + income.other
  );

  return {
    targetSpending: safeTarget,
    availableIncome,
    fundingGap: Math.max(0, safeTarget - availableIncome),
    surplus: Math.max(0, availableIncome - safeTarget),
  };
}

/**
 * Shortfall has one definition and is deliberately computed only after WithdrawalEngine has
 * returned the net (after-tax) cash that can actually be spent.
 *
 * 미달액은 «원 단위»로 닫는다(roundToWon). 인출 엔진은 요청액을 계좌별로 나눠 꺼낸 뒤
 * 세후 현금을 «영수증의 합»으로 다시 만드는데, 마지막 계좌의 몫은 반대로 요청액에서 앞
 * 계좌들을 «빼서» 정한다. 같은 금액을 더하는 순서와 빼는 순서가 다르면 배정밀도에서 1 ulp가
 * 어긋나므로, 요청을 «전부» 채운 달(unfulfilledAmount = 0)에도 세후 현금이 요청액보다
 * 1e-9원쯤 모자란 채 돌아올 수 있다. 그대로 두면 그 잔돈이 unmetSpending에 남아
 * hasSpendingShortfall(엡실론 없음)을 거쳐 HARD 생활비 목표의 「위반」이 된다 —
 * 10억분의 1원은 부족이 아니라 산술 잡음이다.
 *
 * 반대로 targetSpending·availableIncome·withdrawalNetCash·actualSpending은 반올림하지
 * 않는다. 그것들은 계좌가 실제로 옮긴 금액이고 원장 항등식이 그 위에 서 있다(money.ts 주석).
 * 잔여값 하나만 원 단위로 재는 것이 이 비대칭의 전부다.
 */
export function completeCashFlow(
  gap: FundingGapResult,
  withdrawalNetCash: number
): CompletedCashFlow {
  const usableWithdrawal = Math.min(gap.fundingGap, Math.max(0, withdrawalNetCash));
  const actualSpending = Math.min(
    gap.targetSpending,
    gap.availableIncome + usableWithdrawal
  );

  return {
    ...gap,
    withdrawalNetCash: usableWithdrawal,
    actualSpending,
    shortfall: roundToWon(Math.max(0, gap.targetSpending - actualSpending)),
  };
}

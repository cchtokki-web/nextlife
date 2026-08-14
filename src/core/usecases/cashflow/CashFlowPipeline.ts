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
    shortfall: Math.max(0, gap.targetSpending - actualSpending),
  };
}

import type { AccountWithdrawalPolicy, AccountWithdrawalType } from '../../entities/types';

export type WithdrawalPolicy = AccountWithdrawalPolicy;
export type WithdrawalAccountType = AccountWithdrawalType;

export interface WithdrawalReceipt {
  gross: number;
  tax: number;
  net: number;
}

/**
 * A simulation-run account adapter. The engine owns eligibility, limits, protected balances and
 * ordering; the adapter owns account-specific tax/accounting and mutates only its run-local copy.
 */
export interface AssetAccount {
  id: string;
  type: WithdrawalAccountType;
  balance: number;
  withdrawable?: boolean;
  minimumWithdrawalAge?: number;
  withdrawalLimit?: number;
  protectedMinimumBalance?: number;
  /** Used only by TAX_OPTIMIZED. It is supplied by the tax/account adapter, not recommended here. */
  estimatedTaxRate?: number;
  currentBalance?: () => number;
  availableGross?: () => number;
  withdrawForNet: (netRequested: number, grossLimit: number) => WithdrawalReceipt;
}

export interface WithdrawalStrategy {
  policy: WithdrawalPolicy;
  /** Account types or concrete account ids, from first to last. Used only by CUSTOM. */
  customOrder?: readonly (WithdrawalAccountType | string)[];
}

export interface WithdrawalRequest {
  age: number;
  year: number;
  netCashRequired: number;
  accounts: readonly AssetAccount[];
  strategy: WithdrawalStrategy;
  /** Total assets above a plan-level protected floor. Infinity means no plan-level floor. */
  liquidatableHeadroom?: number;
}

export interface AccountWithdrawal extends WithdrawalReceipt {
  accountId: string;
  accountType: WithdrawalAccountType;
}

export interface RemainingAssetAccount {
  id: string;
  type: WithdrawalAccountType;
  balance: number;
}

export interface WithdrawalResult {
  grossWithdrawal: number;
  tax: number;
  netWithdrawal: number;
  withdrawalsByAccount: AccountWithdrawal[];
  remainingAccounts: RemainingAssetAccount[];
  unfulfilledAmount: number;
}

interface EligibleAccount {
  account: AssetAccount;
  availableGross: number;
  inputIndex: number;
}

const POLICY_ORDER: Record<Exclude<WithdrawalPolicy, 'TAX_OPTIMIZED' | 'PROPORTIONAL' | 'CUSTOM'>, readonly WithdrawalAccountType[]> = {
  GENERAL_FIRST: ['CASH', 'GENERAL', 'PENSION_SAVINGS', 'IRP', 'PRIVATE_PENSION', 'ISA'],
  ISA_FIRST: ['CASH', 'ISA', 'GENERAL', 'PENSION_SAVINGS', 'IRP', 'PRIVATE_PENSION'],
  PENSION_FIRST: ['CASH', 'PENSION_SAVINGS', 'IRP', 'PRIVATE_PENSION', 'GENERAL', 'ISA'],
};

const TAX_TIE_BREAK_ORDER: readonly WithdrawalAccountType[] =
  ['CASH', 'ISA', 'GENERAL', 'PENSION_SAVINGS', 'IRP', 'PRIVATE_PENSION'];

function finiteNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

/** Framework-independent account withdrawal service. It evaluates a strategy; it never recommends one. */
export class WithdrawalEngine {
  withdraw(request: WithdrawalRequest): WithdrawalResult {
    let remainingNet = Math.max(0, request.netCashRequired);
    let remainingHeadroom = request.liquidatableHeadroom === undefined
      ? Infinity
      : Math.max(0, request.liquidatableHeadroom);
    const withdrawalsByAccount: AccountWithdrawal[] = [];
    const eligible = this.eligibleAccounts(request);

    if (request.strategy.policy === 'PROPORTIONAL') {
      const totalAvailable = eligible.reduce((sum, item) => sum + item.availableGross, 0);
      // 보호자산 하한으로 실제 청산 가능한 총액이 더 작다면 그 금액 자체를 비례 배분한다.
      // 요청액을 그대로 쓰면 앞 계좌의 몫만으로 headroom이 소진되어 입력 순서 인출이 된다.
      const targetNet = Math.min(remainingNet, remainingHeadroom);
      for (const item of eligible) {
        if (remainingNet <= 0 || remainingHeadroom <= 0) break;
        const share = totalAvailable > 0 ? item.availableGross / totalAvailable : 0;
        const requestedShare = targetNet * share;
        const receipt = this.withdrawFromAccount(
          item,
          Math.min(remainingNet, requestedShare),
          remainingHeadroom
        );
        if (receipt.gross > 0) withdrawalsByAccount.push(receipt);
        remainingNet -= receipt.net;
        remainingHeadroom -= receipt.gross;
      }

      // Tax/caps can leave a small remainder after the proportional pass. Preserve the policy's
      // proportions first, then use still-available accounts to finish the cash requirement.
      for (const item of eligible) {
        if (remainingNet <= 0 || remainingHeadroom <= 0) break;
        const receipt = this.withdrawFromAccount(item, remainingNet, remainingHeadroom);
        this.mergeReceipt(withdrawalsByAccount, receipt);
        remainingNet -= receipt.net;
        remainingHeadroom -= receipt.gross;
      }
    } else {
      for (const item of this.orderAccounts(eligible, request.strategy)) {
        if (remainingNet <= 0 || remainingHeadroom <= 0) break;
        const receipt = this.withdrawFromAccount(item, remainingNet, remainingHeadroom);
        if (receipt.gross > 0) withdrawalsByAccount.push(receipt);
        remainingNet -= receipt.net;
        remainingHeadroom -= receipt.gross;
      }
    }

    const grossWithdrawal = withdrawalsByAccount.reduce((sum, item) => sum + item.gross, 0);
    const tax = withdrawalsByAccount.reduce((sum, item) => sum + item.tax, 0);
    const netWithdrawal = withdrawalsByAccount.reduce((sum, item) => sum + item.net, 0);
    const grossByAccount = new Map<string, number>();
    for (const withdrawal of withdrawalsByAccount) {
      grossByAccount.set(
        withdrawal.accountId,
        (grossByAccount.get(withdrawal.accountId) ?? 0) + withdrawal.gross
      );
    }

    return {
      grossWithdrawal,
      tax,
      netWithdrawal,
      withdrawalsByAccount,
      remainingAccounts: request.accounts.map((account) => ({
        id: account.id,
        type: account.type,
        // currentBalance 콜백만 실제 계좌잔액의 권위 있는 값이다. availableGross는 한도·ISA
        // 납입원금처럼 인출 가능액일 수 있으므로 잔액으로 사용하지 않는다.
        balance: Math.max(
          0,
          account.currentBalance?.() ?? account.balance - (grossByAccount.get(account.id) ?? 0)
        ),
      })),
      unfulfilledAmount: Math.max(0, remainingNet),
    };
  }

  private eligibleAccounts(request: WithdrawalRequest): EligibleAccount[] {
    return request.accounts.flatMap((account, inputIndex) => {
      if (account.withdrawable === false) return [];
      if (request.age < (account.minimumWithdrawalAge ?? 0)) return [];

      const liveBalance = Math.max(0, account.currentBalance?.() ?? account.balance);
      const sourceAvailable = Math.max(0, account.availableGross?.() ?? liveBalance);
      const protectedBalance = finiteNonNegative(account.protectedMinimumBalance, 0);
      const accountHeadroom = Math.max(0, liveBalance - protectedBalance);
      const withdrawalLimit = finiteNonNegative(account.withdrawalLimit, Infinity);
      const availableGross = Math.min(sourceAvailable, accountHeadroom, withdrawalLimit);
      return availableGross > 0 ? [{ account, availableGross, inputIndex }] : [];
    });
  }

  private orderAccounts(
    accounts: readonly EligibleAccount[],
    strategy: WithdrawalStrategy
  ): EligibleAccount[] {
    if (strategy.policy === 'TAX_OPTIMIZED') {
      return [...accounts].sort((a, b) => {
        const taxDifference = finiteNonNegative(a.account.estimatedTaxRate, 0)
          - finiteNonNegative(b.account.estimatedTaxRate, 0);
        if (taxDifference !== 0) return taxDifference;
        const typeDifference = TAX_TIE_BREAK_ORDER.indexOf(a.account.type)
          - TAX_TIE_BREAK_ORDER.indexOf(b.account.type);
        return typeDifference || a.inputIndex - b.inputIndex;
      });
    }

    if (strategy.policy === 'CUSTOM') {
      const customOrder = strategy.customOrder ?? [];
      const priority = (account: AssetAccount) => {
        const idPriority = customOrder.indexOf(account.id);
        if (idPriority >= 0) return idPriority;
        const typePriority = customOrder.indexOf(account.type);
        return typePriority >= 0 ? typePriority : customOrder.length;
      };
      return [...accounts].sort((a, b) =>
        priority(a.account) - priority(b.account) || a.inputIndex - b.inputIndex
      );
    }

    if (strategy.policy === 'PROPORTIONAL') return [...accounts];

    const order = POLICY_ORDER[strategy.policy];
    return [...accounts].sort((a, b) =>
      order.indexOf(a.account.type) - order.indexOf(b.account.type) || a.inputIndex - b.inputIndex
    );
  }

  private withdrawFromAccount(
    item: EligibleAccount,
    netRequested: number,
    remainingHeadroom: number
  ): AccountWithdrawal {
    const liveBalance = Math.max(0, item.account.currentBalance?.() ?? item.account.balance);
    const sourceAvailable = Math.max(0, item.account.availableGross?.() ?? liveBalance);
    const protectedBalance = finiteNonNegative(item.account.protectedMinimumBalance, 0);
    const accountHeadroom = Math.max(0, liveBalance - protectedBalance);
    const grossLimit = Math.min(item.availableGross, sourceAvailable, accountHeadroom, remainingHeadroom);
    if (netRequested <= 0 || grossLimit <= 0) {
      return { accountId: item.account.id, accountType: item.account.type, gross: 0, tax: 0, net: 0 };
    }

    const raw = item.account.withdrawForNet(netRequested, grossLimit);
    const gross = Math.min(grossLimit, Math.max(0, raw.gross));
    const tax = Math.min(gross, Math.max(0, raw.tax));
    const net = Math.min(gross - tax, Math.max(0, raw.net), netRequested);
    item.availableGross = Math.max(0, item.availableGross - gross);
    return { accountId: item.account.id, accountType: item.account.type, gross, tax, net };
  }

  private mergeReceipt(target: AccountWithdrawal[], receipt: AccountWithdrawal): void {
    if (receipt.gross <= 0) return;
    const existing = target.find((item) => item.accountId === receipt.accountId);
    if (!existing) {
      target.push(receipt);
      return;
    }
    existing.gross += receipt.gross;
    existing.tax += receipt.tax;
    existing.net += receipt.net;
  }
}

/** Tax-free account adapter used for cash and other already-taxed balances. */
export function taxFreeAccount(input: {
  id: string;
  type: WithdrawalAccountType;
  balance: () => number;
  availableGross?: () => number;
  withdraw: (gross: number) => number;
  minimumWithdrawalAge?: number;
  withdrawalLimit?: number;
  protectedMinimumBalance?: number;
}): AssetAccount {
  return {
    id: input.id,
    type: input.type,
    balance: input.balance(),
    currentBalance: input.balance,
    availableGross: input.availableGross ?? input.balance,
    ...(input.minimumWithdrawalAge !== undefined
      ? { minimumWithdrawalAge: input.minimumWithdrawalAge }
      : {}),
    ...(input.withdrawalLimit !== undefined ? { withdrawalLimit: input.withdrawalLimit } : {}),
    ...(input.protectedMinimumBalance !== undefined
      ? { protectedMinimumBalance: input.protectedMinimumBalance }
      : {}),
    estimatedTaxRate: 0,
    withdrawForNet: (netRequested, grossLimit) => {
      const requested = Math.min(grossLimit, Math.max(0, netRequested));
      const gross = Math.min(requested, Math.max(0, input.withdraw(requested)));
      return { gross, tax: 0, net: gross };
    },
  };
}

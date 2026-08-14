export interface LiquidatableSource {
  /** Gross amount currently available, in the simulation display currency. */
  availableGross: () => number;
  /**
   * Withdraws enough to target netRequested, capped by grossLimit, and returns the actual amounts. Implementations
   * own account-specific tax rules and mutate only their simulation-run account copy.
   */
  withdrawForNet: (netRequested: number, grossLimit: number) => WithdrawalReceipt;
}

export interface WithdrawalReceipt {
  gross: number;
  tax: number;
  net: number;
}

export interface WithdrawalRequest {
  requiredNetCash: number;
  /** Total assets minus a HARD protected-asset floor. Infinity means no protected floor. */
  liquidatableHeadroom: number;
  sources: readonly LiquidatableSource[];
}

export interface WithdrawalResult extends WithdrawalReceipt {
  unmetNetCash: number;
}

const EMPTY_RECEIPT: WithdrawalReceipt = { gross: 0, tax: 0, net: 0 };

/** Framework-independent, ordered liquidation service used by the cash-flow pipeline. */
export class WithdrawalEngine {
  withdraw(request: WithdrawalRequest): WithdrawalResult {
    let remainingNet = Math.max(0, request.requiredNetCash);
    let remainingHeadroom = Math.max(0, request.liquidatableHeadroom);
    const total = { ...EMPTY_RECEIPT };

    for (const source of request.sources) {
      if (remainingNet <= 0 || remainingHeadroom <= 0) break;

      const grossLimit = Math.min(
        Math.max(0, source.availableGross()),
        remainingHeadroom
      );
      if (grossLimit <= 0) continue;

      // A taxed source may need a gross withdrawal larger than the requested net cash. The source
      // owns that reverse calculation and must never withdraw more than grossLimit.
      const receipt = source.withdrawForNet(remainingNet, grossLimit);
      const gross = Math.min(grossLimit, Math.max(0, receipt.gross));
      const tax = Math.min(gross, Math.max(0, receipt.tax));
      const net = Math.min(gross - tax, Math.max(0, receipt.net), remainingNet);

      total.gross += gross;
      total.tax += tax;
      total.net += net;
      remainingHeadroom -= gross;
      remainingNet -= net;
    }

    return {
      ...total,
      unmetNetCash: Math.max(0, remainingNet),
    };
  }
}

/** Creates a tax-free source which withdraws no more than the still-required net cash. */
export function taxFreeSource(
  available: () => number,
  withdraw: (gross: number) => number
): LiquidatableSource {
  return {
    availableGross: available,
    withdrawForNet: (netRequested, grossLimit) => {
      const requested = Math.min(grossLimit, Math.max(0, netRequested));
      const gross = Math.min(requested, Math.max(0, withdraw(requested)));
      return { gross, tax: 0, net: gross };
    },
  };
}

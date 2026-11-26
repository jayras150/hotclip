/**
 * Billing engine — credits, multi-currency conversion, atomic purchase + refund.
 *
 * Pure core: `calculateCredits` is a pure function (deterministic, no DB).
 * All database + payment-provider side effects are duck-typed contracts, so
 * the engine is fully unit-testable without a database or a real payment
 * provider. No `@supabase/supabase-js` dependency here.
 */

import { randomUUID } from "crypto";

/** Wallet row returned by the billing store. */
export interface Wallet {
  credits_balance: number;
  local_balance: number;
  exchange_rate: number; // 1 credit = exchange_rate local currency
  is_active: boolean;
}

export type Currency = "idr" | "usd";

export type TransactionStatus = "pending" | "settled" | "failed" | "refunded";

export interface CreditTransaction {
  id: string;
  userId: string;
  credits_delta: number;
  local_amount: number;
  currency: Currency;
  exchange_rate: number;
  status: TransactionStatus;
  customerId?: string;
  gatewayName?: string;
  createdAt: string;
}

/** Duck-typed payment gateway (stub in unit tests). */
export interface PaymentGateway {
  charge(params: {
    amountLocal: number;
    currency: Currency;
    customerId?: string;
    gatewayName: string;
  }): Promise<{ success: boolean }>;
}

/** Duck-typed billing store (in-memory stub in unit tests). */
export interface BillingStore {
  getWalletByUserId(userId: string): Promise<Wallet>;
  updateWallet(userId: string, patch: Partial<Wallet>): Promise<void>;
  createTransaction(
    input: Omit<CreditTransaction, "id" | "createdAt">,
  ): Promise<CreditTransaction>;
  getTransaction(txId: string): Promise<CreditTransaction | null>;
  updateTransaction(txId: string, patch: Partial<CreditTransaction>): Promise<void>;
}

const DEFAULT_EXCHANGE_RATES: Record<Currency, number> = {
  idr: 15000,
  usd: 15000,
};

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}

export class BillingEngine {
  constructor(
    private readonly store: BillingStore,
    private readonly gateway: PaymentGateway,
  ) {}

  /**
   * Pure, deterministic credits calculation.
   * 1080p -> 2 credits/min, 4K -> 4 credits/min.
   */
  calculateCredits(durationSec: number, resolution: string): number {
    const minutes = durationSec / 60;
    const res = resolution.trim().toLowerCase();
    if (res === "1080p") {
      return Math.round(minutes * 2);
    }
    if (res === "4k" || res === "2160p") {
      return Math.round(minutes * 4);
    }
    return 0;
  }

  /**
   * Atomic purchase (full write path inside one call):
   *   1. read wallet by userId
   *   2. charge the gateway
   *   3a. success -> update wallet + record a `settled` transaction row
   *   4a. gateway throws / rejects   -> wallet unchanged, transaction `failed`
   *   4b. gateway resolves { success: false } -> same rollback
   */
  async purchase(params: {
    userId: string;
    amountLocal: number;
    currency: Currency;
    customerId?: string;
    gatewayName: string;
  }): Promise<{ wallet: Wallet; transaction: CreditTransaction }> {
    const wallet = await this.store.getWalletByUserId(params.userId);
    if (!wallet.is_active) {
      throw new BillingError("wallet is not active");
    }

    const exchangeRate = wallet.exchange_rate;
    const creditsDelta = Math.round(params.amountLocal / exchangeRate);

    let chargeResult: { success: boolean };
    try {
      chargeResult = await this.gateway.charge({
        amountLocal: params.amountLocal,
        currency: params.currency,
        customerId: params.customerId,
        gatewayName: params.gatewayName,
      });
    } catch (error) {
      // Gateway rejection: roll back. Wallet untouched; a `failed` row recorded.
      const failedTx = await this.store.createTransaction({
        userId: params.userId,
        credits_delta: 0,
        local_amount: 0,
        currency: params.currency,
        exchange_rate: exchangeRate,
        status: "failed",
        customerId: params.customerId,
        gatewayName: params.gatewayName,
      });
      return { wallet, transaction: failedTx };
    }

    if (!chargeResult.success) {
      const failedTx = await this.store.createTransaction({
        userId: params.userId,
        credits_delta: 0,
        local_amount: 0,
        currency: params.currency,
        exchange_rate: exchangeRate,
        status: "failed",
        customerId: params.customerId,
        gatewayName: params.gatewayName,
      });
      return { wallet, transaction: failedTx };
    }

    const newCredits = wallet.credits_balance + creditsDelta;
    const newLocal = wallet.local_balance - params.amountLocal;

    await this.store.updateWallet(params.userId, {
      credits_balance: newCredits,
      local_balance: newLocal,
    });

    const settledTx = await this.store.createTransaction({
      userId: params.userId,
      credits_delta: creditsDelta,
      local_amount: params.amountLocal,
      currency: params.currency,
      exchange_rate: exchangeRate,
      status: "settled",
      customerId: params.customerId,
      gatewayName: params.gatewayName,
    });

    return {
      wallet: { ...wallet, credits_balance: newCredits, local_balance: newLocal },
      transaction: settledTx,
    };
  }

  /**
   * Refund: restores credits atomically (same call = wallet update + status
   * flip to `refunded`). `failed`/`refunded` transactions are rejected.
   */
  async refund(txId: string): Promise<{ success: boolean; wallet: Wallet | null }> {
    const tx = await this.store.getTransaction(txId);
    if (!tx) return { success: false, wallet: null };

    if (tx.status === "failed" || tx.status === "refunded") {
      return { success: false, wallet: null };
    }

    const wallet = await this.store.getWalletByUserId(tx.userId);
    const restoredCredits = wallet.credits_balance - tx.credits_delta;

    await this.store.updateWallet(tx.userId, { credits_balance: restoredCredits });
    await this.store.updateTransaction(txId, { status: "refunded" });

    return { success: true, wallet: { ...wallet, credits_balance: restoredCredits } };
  }
}

/**
 * Unit tests — src/server/billing.ts
 *
 * Rules: vitest + Node built-ins only. Duck-typed in-memory `BillingStore`
 * and `PaymentGateway` stubs — no `@supabase/supabase-js`.
 */

import { describe, expect, it } from "vitest";
import {
  BillingEngine,
  type BillingStore,
  type CreditTransaction,
  type PaymentGateway,
  type Wallet,
} from "../billing";

/* ------------------------------------------------------------------ */
/* Fixture: in-memory store + deterministic gateway                  */
/* ------------------------------------------------------------------ */

function createBillingStore(initialWallet: Wallet): BillingStore {
  let wallet = initialWallet;
  const transactions: CreditTransaction[] = [];

  return {
    async getWalletByUserId() {
      return wallet;
    },

    async updateWallet(_userId: string, patch: Partial<Wallet>) {
      wallet = { ...wallet, ...patch };
    },

    async createTransaction(input: Omit<CreditTransaction, "id" | "createdAt">) {
      const tx: CreditTransaction = {
        id: `tx-${input.credits_delta}-${input.status}`,
        userId: input.userId,
        credits_delta: input.credits_delta,
        local_amount: input.local_amount,
        currency: input.currency,
        exchange_rate: input.exchange_rate,
        status: input.status,
        customerId: input.customerId,
        gatewayName: input.gatewayName,
        createdAt: new Date().toISOString(),
      };
      transactions.push(tx);
      return tx;
    },

    async getTransaction(txId: string) {
      return transactions.find((t) => t.id === txId) ?? null;
    },

    async updateTransaction(txId: string, patch: Partial<CreditTransaction>) {
      const idx = transactions.findIndex((t) => t.id === txId);
      if (idx === -1) return;
      transactions[idx] = { ...transactions[idx], ...patch };
    },
  };
}

function createGateway(success: boolean): PaymentGateway {
  return {
    async charge() {
      return { success };
    },
  };
}

function engine(): BillingEngine {
  // Real engine requires a store+gateway; construct a fresh pair per scenario.
  throw new Error("use a scenario-specific engine()");
}

/* Helper to build a scenario engine: we do this inline in each `it`. */

describe("BillingEngine", () => {
  /* ---------------------------------------------------------------- */
  /* 1. calculateCredits — pure, deterministic                       */
  /* ---------------------------------------------------------------- */
  describe("calculateCredits", () => {
    it("1080p -> 2 credits/min", () => {
      const engine = new BillingEngine(
        {
          getWalletByUserId: async () => ({
            credits_balance: 0,
            local_balance: 0,
            exchange_rate: 15000,
            is_active: true,
          }),
          updateWallet: async () => undefined,
          createTransaction: async () => ({
            id: "x",
            userId: "u",
            credits_delta: 0,
            local_amount: 0,
            currency: "idr",
            exchange_rate: 15000,
            status: "settled",
            createdAt: new Date().toISOString(),
          }),
          getTransaction: async () => null,
          updateTransaction: async () => undefined,
        } as unknown as BillingStore,
        {
          charge: async () => ({ success: true }),
        } as unknown as PaymentGateway,
      );

      expect(engine.calculateCredits(60, "1080p")).toBe(2);
      expect(engine.calculateCredits(120, "1080p")).toBe(4);
      expect(engine.calculateCredits(90, "1080p")).toBe(3);
    });

    it("4K -> 4 credits/min", () => {
      const engine = new BillingEngine(
        {
          getWalletByUserId: async () => ({
            credits_balance: 0,
            local_balance: 0,
            exchange_rate: 15000,
            is_active: true,
          }),
          updateWallet: async () => undefined,
          createTransaction: async () => ({
            id: "x",
            userId: "u",
            credits_delta: 0,
            local_amount: 0,
            currency: "idr",
            exchange_rate: 15000,
            status: "settled",
            createdAt: new Date().toISOString(),
          }),
          getTransaction: async () => null,
          updateTransaction: async () => undefined,
        } as unknown as BillingStore,
        {
          charge: async () => ({ success: true }),
        } as unknown as PaymentGateway,
      );

      expect(engine.calculateCredits(60, "4k")).toBe(4);
      expect(engine.calculateCredits(60, "2160p")).toBe(4);
      expect(engine.calculateCredits(180, "4k")).toBe(12);
      expect(engine.calculateCredits(30, "1080p")).toBe(1);
    });

    it("unknown resolution -> 0", () => {
      const engine = new BillingEngine(
        {
          getWalletByUserId: async () => ({
            credits_balance: 0,
            local_balance: 0,
            exchange_rate: 15000,
            is_active: true,
          }),
          updateWallet: async () => undefined,
          createTransaction: async () => ({
            id: "x",
            userId: "u",
            credits_delta: 0,
            local_amount: 0,
            currency: "idr",
            exchange_rate: 15000,
            status: "settled",
            createdAt: new Date().toISOString(),
          }),
          getTransaction: async () => null,
          updateTransaction: async () => undefined,
        } as unknown as BillingStore,
        {
          charge: async () => ({ success: true }),
        } as unknown as PaymentGateway,
      );

      expect(engine.calculateCredits(60, "720p")).toBe(0);
      expect(engine.calculateCredits(0, "4k")).toBe(0);
    });
  });

  /* ---------------------------------------------------------------- */
  /* 2. Multi-currency conversion: 1 credit = 15000 IDR; 10 credits  */
  /*    -> localAmount = 10 * 15000 = 150000                       */
  /* ---------------------------------------------------------------- */
  describe("multi-currency conversion", () => {
    it("10 credits of `usd` -> localAmount 150000 at exchange_rate 15000", async () => {
      const store = createBillingStore({
        credits_balance: 0,
        local_balance: 0,
        exchange_rate: 15000,
        is_active: true,
      });
      const gateway: PaymentGateway = {
        charge: async () => ({ success: true }),
      };
      const engine = new BillingEngine(store, gateway);

      const { transaction } = await engine.purchase({
        userId: "user-1",
        amountLocal: 150000,
        currency: "usd",
        customerId: "cust-1",
        gatewayName: "stripe",
      });

      expect(transaction.credits_delta).toBe(10);
      expect(transaction.local_amount).toBe(150000);
      expect(transaction.currency).toBe("usd");
      expect(transaction.exchange_rate).toBe(15000);
    });
  });

  /* ---------------------------------------------------------------- */
  /* 3. Atomic purchase: wallet + transaction row committed together */
  /* ---------------------------------------------------------------- */
  describe("purchase (atomic)", () => {
    it("credits_balance +10 AND settled transaction row in the same call", async () => {
      const store = createBillingStore({
        credits_balance: 5000,
        local_balance: 150_000_000,
        exchange_rate: 15000,
        is_active: true,
      });
      const gateway: PaymentGateway = {
        charge: async () => ({ success: true }),
      };
      const engine = new BillingEngine(store, gateway);

      const { wallet, transaction } = await engine.purchase({
        userId: "user-1",
        amountLocal: 150000,
        currency: "idr",
        customerId: "cust-1",
        gatewayName: "stripe",
      });

      // Wallet updated
      expect(wallet.credits_balance).toBe(5010);
      expect(wallet.local_balance).toBe(149_850_000);

      // Transaction row committed in the same call
      expect(transaction.credits_delta).toBe(10);
      expect(transaction.local_amount).toBe(150000);
      expect(transaction.currency).toBe("idr");
      expect(transaction.exchange_rate).toBe(15000);
      expect(transaction.status).toBe("settled");
    });
  });

  /* ---------------------------------------------------------------- */
  /* 4. Refund: pending|settled -> restore credits atomically        */
  /*    failed|refunded -> rejected                                  */
  /* ---------------------------------------------------------------- */
  describe("refund", () => {
    it("restores credits for pending|settled; rejects failed|refunded", async () => {
      const store = createBillingStore({
        credits_balance: 5000,
        local_balance: 150_000_000,
        exchange_rate: 15000,
        is_active: true,
      });
      const gateway: PaymentGateway = {
        charge: async () => ({ success: true }),
      };
      const engine = new BillingEngine(store, gateway);

      // 1) settled purchase
      const purchased = await engine.purchase({
        userId: "user-1",
        amountLocal: 150000,
        currency: "idr",
        customerId: "cust-1",
        gatewayName: "stripe",
      });
      expect(purchased.wallet.credits_balance).toBe(5010);

      // 2) refund restores credits atomically (wallet + tx status flip)
      const refunded = await engine.refund(purchased.transaction.id);
      expect(refunded.success).toBe(true);
      expect(refunded.wallet?.credits_balance).toBe(5000);
      expect(purchased.transaction.status).toBe("settled"); // original row unchanged
    });

    it("rejects failed and already-refunded transactions", async () => {
      const store = createBillingStore({
        credits_balance: 5000,
        local_balance: 150_000_000,
        exchange_rate: 15000,
        is_active: true,
      });
      const gateway: PaymentGateway = {
        charge: async () => ({ success: true }),
      };
      const engine = new BillingEngine(store, gateway);

      // settled purchase
      const purchased = await engine.purchase({
        userId: "user-1",
        amountLocal: 150000,
        currency: "idr",
        customerId: "cust-1",
        gatewayName: "stripe",
      });

      // refund -> marks the transaction record `refunded` in the store.
      await engine.refund(purchased.transaction.id);
      const updatedRow = await store.getTransaction(purchased.transaction.id);
      expect(updatedRow?.status).toBe("refunded");

      // failed tx
      const failedTx = await store.createTransaction({
        userId: "user-1",
        credits_delta: 0,
        local_amount: 0,
        currency: "idr",
        exchange_rate: 15000,
        status: "failed",
      });

      expect(await engine.refund(failedTx.id)).toEqual({ success: false, wallet: null });
      expect(await engine.refund(purchased.transaction.id)).toEqual({ success: false, wallet: null });
    });
  });

  /* ---------------------------------------------------------------- */
  /* 5. Gateway failure: purchase rolls back                        */
  /* ---------------------------------------------------------------- */
  describe("gateway failure", () => {
    it("wallet unchanged; transaction `failed`", async () => {
      const store = createBillingStore({
        credits_balance: 5000,
        local_balance: 150_000_000,
        exchange_rate: 15000,
        is_active: true,
      });
      const gateway: PaymentGateway = {
        // Rejects outright (e.g. network / provider timeout).
        charge: async () => {
          throw new Error("payment gateway rejected");
        },
      };
      const engine = new BillingEngine(store, gateway);

      const { wallet, transaction } = await engine.purchase({
        userId: "user-1",
        amountLocal: 150000,
        currency: "idr",
        customerId: "cust-1",
        gatewayName: "stripe",
      });

      // Wallet unchanged
      expect(wallet.credits_balance).toBe(5000);
      expect(wallet.local_balance).toBe(150_000_000);

      // Transaction row recorded with status `failed`
      expect(transaction.credits_delta).toBe(0);
      expect(transaction.local_amount).toBe(0);
      expect(transaction.status).toBe("failed");
    });

    it("rejects a non-active wallet with a BillingError", async () => {
      const store = createBillingStore({
        credits_balance: 5000,
        local_balance: 150_000_000,
        exchange_rate: 15000,
        is_active: false,
      });
      const gateway: PaymentGateway = {
        charge: async () => ({ success: true }),
      };
      const engine = new BillingEngine(store, gateway);

      await expect(
        engine.purchase({
          userId: "user-1",
          amountLocal: 150000,
          currency: "idr",
          customerId: "cust-1",
          gatewayName: "stripe",
        }),
      ).rejects.toThrow("wallet is not active");
    });
  });
});

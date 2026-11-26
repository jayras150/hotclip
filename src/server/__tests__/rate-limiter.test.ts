import { describe, it, expect } from "vitest";
import type { IncomingMessage } from "node:http";
import {
  createRateLimiter,
  createUserRateLimiter,
  ipKey,
} from "../rate-limiter.js";

function reqWithIp(ip: string): IncomingMessage {
  return { socket: { remoteAddress: ip } } as unknown as IncomingMessage;
}

function reqWithHeader(name: string, value: string): IncomingMessage {
  return { headers: { [name]: value } } as unknown as IncomingMessage;
}

describe("createRateLimiter (sliding window)", () => {
  it("mengizinkan request ke-1..3 dan memblokir ke-4 (maxRequests=3)", () => {
    let clock = 0;
    const limiter = createRateLimiter({
      maxRequests: 3,
      windowMs: 60_000,
      now: () => clock,
    });

    const first = limiter.check(reqWithIp("1.1.1.1"));
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);
    expect(first.limit).toBe(3);

    const second = limiter.check(reqWithIp("1.1.1.1"));
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);

    const third = limiter.check(reqWithIp("1.1.1.1"));
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = limiter.check(reqWithIp("1.1.1.1"));
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("IP berbeda punya bucket terpisah", () => {
    let clock = 0;
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 60_000,
      now: () => clock,
    });

    expect(limiter.check(reqWithIp("10.0.0.1")).allowed).toBe(true);
    expect(limiter.check(reqWithIp("10.0.0.1")).allowed).toBe(true);
    expect(limiter.check(reqWithIp("10.0.0.1")).allowed).toBe(false);

    // IP lain masih punya kuota penuh.
    const other = limiter.check(reqWithIp("10.0.0.2"));
    expect(other.allowed).toBe(true);
    expect(other.remaining).toBe(1);
  });

  it("custom key resolver: user berbeda tidak saling memengaruhi, user sama berbagi bucket", () => {
    let clock = 0;
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 60_000,
      key: (req) => String(req.headers["x-user"]),
      now: () => clock,
    });

    const aliceA = reqWithHeader("x-user", "alice");
    const aliceB = reqWithHeader("x-user", "alice");
    const bob = reqWithHeader("x-user", "bob");

    expect(limiter.check(aliceA).allowed).toBe(true);
    expect(limiter.check(aliceB).allowed).toBe(true);
    // User sama -> bucket sama -> kena limit.
    expect(limiter.check(aliceA).allowed).toBe(false);
    // User berbeda -> bucket terpisah.
    expect(limiter.check(bob).allowed).toBe(true);
  });

  it("window bergulir: setelah clock melewati windowMs, request kembali allowed", () => {
    let clock = 0;
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 60_000,
      now: () => clock,
    });

    expect(limiter.check(reqWithIp("2.2.2.2")).allowed).toBe(true);
    expect(limiter.check(reqWithIp("2.2.2.2")).allowed).toBe(true);
    expect(limiter.check(reqWithIp("2.2.2.2")).allowed).toBe(false);

    clock += 60_000;

    const after = limiter.check(reqWithIp("2.2.2.2"));
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(1);
  });

  it("reset(key) mengosongkan satu bucket, reset() mengosongkan semua", () => {
    let clock = 0;
    const limiter = createRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      now: () => clock,
    });

    expect(limiter.check(reqWithIp("3.3.3.3")).allowed).toBe(true);
    expect(limiter.check(reqWithIp("4.4.4.4")).allowed).toBe(true);
    expect(limiter.check(reqWithIp("3.3.3.3")).allowed).toBe(false);
    expect(limiter.check(reqWithIp("4.4.4.4")).allowed).toBe(false);

    limiter.reset("3.3.3.3");
    expect(limiter.check(reqWithIp("3.3.3.3")).allowed).toBe(true);
    // 4.4.4.4 masih kena limit.
    expect(limiter.check(reqWithIp("4.4.4.4")).allowed).toBe(false);

    limiter.reset();
    expect(limiter.check(reqWithIp("4.4.4.4")).allowed).toBe(true);
  });

  it("peek() tidak menambah hitungan", () => {
    let clock = 0;
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 60_000,
      now: () => clock,
    });

    limiter.check(reqWithIp("5.5.5.5"));
    limiter.check(reqWithIp("5.5.5.5"));

    // Peek 3x tidak boleh mengubah state.
    for (let i = 0; i < 3; i++) {
      const peeked = limiter.peek(reqWithIp("5.5.5.5"));
      expect(peeked.allowed).toBe(false);
      expect(peeked.remaining).toBe(0);
    }

    // Dengan maxRequests=1 untuk bucket lain: peek berkali-kali tetap allowed.
    let clock2 = 0;
    const limiter2 = createRateLimiter({
      maxRequests: 3,
      windowMs: 60_000,
      now: () => clock2,
    });
    for (let i = 0; i < 3; i++) {
      const peeked = limiter2.peek(reqWithIp("6.6.6.6"));
      expect(peeked.allowed).toBe(true);
      expect(peeked.remaining).toBe(3);
    }
    // Setelah 3x peek, check pertama tetap allowed (peek tidak mencatat).
    expect(limiter2.check(reqWithIp("6.6.6.6")).allowed).toBe(true);
  });

  it("ipKey() fallback ke 'unknown' bila socket/remoteAddress tidak ada", () => {
    expect(ipKey(reqWithIp("9.9.9.9"))).toBe("9.9.9.9");

    const noSocket = {} as unknown as IncomingMessage;
    expect(ipKey(noSocket)).toBe("unknown");

    const emptyAddress = { socket: { remoteAddress: "" } } as unknown as IncomingMessage;
    expect(ipKey(emptyAddress)).toBe("unknown");
  });
});

describe("createUserRateLimiter", () => {
  it("5 request pertama allowed, ke-6 ditolak dengan reason 'minute'", () => {
    let clock = 0;
    const limiter = createUserRateLimiter({ now: () => clock });

    for (let i = 0; i < 5; i++) {
      const result = limiter.check("user-a");
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    }

    const sixth = limiter.check("user-a");
    expect(sixth.allowed).toBe(false);
    expect(sixth.reason).toBe("minute");
    expect(sixth.minuteRemaining).toBe(0);
  });

  it("request yang ditolak tidak menambah hitungan; setelah 60s allowed lagi", () => {
    let clock = 0;
    const limiter = createUserRateLimiter({ now: () => clock });

    for (let i = 0; i < 5; i++) {
      expect(limiter.check("user-b").allowed).toBe(true);
    }
    // Beberapa penolakan berturut-turut tidak mengkonsumsi kuota.
    expect(limiter.check("user-b").reason).toBe("minute");
    expect(limiter.check("user-b").reason).toBe("minute");

    clock += 60_000;
    const after = limiter.check("user-b");
    expect(after.allowed).toBe(true);
    expect(after.minuteRemaining).toBe(4);
  });

  it("kuota harian: request ke-3 ditolak dengan reason 'day'", () => {
    let clock = 0;
    const limiter = createUserRateLimiter({
      maxPerMinute: 100,
      maxPerDay: 2,
      now: () => clock,
    });

    expect(limiter.check("user-c").allowed).toBe(true);
    expect(limiter.check("user-c").allowed).toBe(true);

    const third = limiter.check("user-c");
    expect(third.allowed).toBe(false);
    expect(third.reason).toBe("day");
    expect(third.dayRemaining).toBe(0);

    // Window menit belum habis, tapi penolakan 'day' tetap tidak menambah hitungan.
    clock += 60_000;
    const afterMinute = limiter.check("user-c");
    expect(afterMinute.allowed).toBe(false);
    expect(afterMinute.reason).toBe("day");
  });

  it("user berbeda punya kuota terpisah", () => {
    let clock = 0;
    const limiter = createUserRateLimiter({ now: () => clock });

    for (let i = 0; i < 5; i++) {
      expect(limiter.check("user-d").allowed).toBe(true);
    }
    expect(limiter.check("user-d").reason).toBe("minute");

    // User lain masih punya kuota penuh.
    const other = limiter.check("user-e");
    expect(other.allowed).toBe(true);
    expect(other.minuteRemaining).toBe(4);
  });

  it("reset(userId) memulihkan kuota user tersebut saja", () => {
    let clock = 0;
    const limiter = createUserRateLimiter({ now: () => clock });

    for (let i = 0; i < 5; i++) {
      expect(limiter.check("user-f").allowed).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("user-g").allowed).toBe(true);
    }
    expect(limiter.check("user-f").reason).toBe("minute");
    expect(limiter.check("user-g").reason).toBe("minute");

    limiter.reset("user-f");
    expect(limiter.check("user-f").allowed).toBe(true);
    // user-g masih kena limit.
    expect(limiter.check("user-g").reason).toBe("minute");
  });

  it("default tanpa opsi tetap 5 per menit", () => {
    let clock = 0;
    const limiter = createUserRateLimiter({ now: () => clock });

    for (let i = 0; i < 5; i++) {
      const result = limiter.check("user-h");
      expect(result.allowed).toBe(true);
    }
    const sixth = limiter.check("user-h");
    expect(sixth.allowed).toBe(false);
    expect(sixth.reason).toBe("minute");
  });
});

// Simulasi logika presignPut + ensureCapacity sesuai pool-manager.ts
const quota = BigInt(10_000_000_000);
const used = BigInt(10_000_000_000);
const available = Number(quota - used);
console.log("quota_bytes:", quota, "used:", used, "available:", available, "<= 0 ?", available <= 0);

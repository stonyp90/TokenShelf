export function formatTokens(n: number | bigint): string {
  const v = typeof n === "bigint" ? Number(n) : n;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toLocaleString();
}

export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${dollars.toFixed(0)}`;
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  return `$${dollars.toFixed(3)}`;
}

export function outputPerDollar(outputTokens: number | bigint, cents: number): string {
  const v = typeof outputTokens === "bigint" ? Number(outputTokens) : outputTokens;
  if (cents <= 0) return "—";
  const perDollar = v / (cents / 100);
  return `${formatTokens(perDollar)} tok/$`;
}

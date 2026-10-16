// Minimal assertion helpers (no network dependency needed to run tests).
export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
export function assertFalse(cond: unknown, msg = "expected falsy") { if (cond) throw new Error(msg); }
export function assertEquals(a: unknown, b: unknown, msg?: string) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(msg ?? `expected ${sb}\n     got ${sa}`);
}
export function assertThrows(fn: () => unknown, ctor?: new (...a: any[]) => Error) {
  try { fn(); } catch (e) {
    if (ctor && !(e instanceof ctor)) throw new Error(`wrong error type: ${e}`);
    return;
  }
  throw new Error("expected function to throw");
}

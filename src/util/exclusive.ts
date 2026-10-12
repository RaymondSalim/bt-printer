// Runs at most one call of `fn` at a time. A call made while another is in
// flight is dropped and reported through `onBusy`; the guard is released when
// the running call settles, whether it resolves or rejects.
export function exclusive<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
  onBusy?: () => void,
): (...args: A) => Promise<void> {
  let running = false
  return async (...args: A) => {
    if (running) {
      onBusy?.()
      return
    }
    running = true
    try {
      await fn(...args)
    } finally {
      running = false
    }
  }
}

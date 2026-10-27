// Waits for the promise `get` returns, and keeps waiting while `get` hands back a
// different promise afterwards, so work that was restarted mid-wait is included.
export async function awaitStable(get: () => Promise<unknown>): Promise<void> {
  let current: Promise<unknown>
  do {
    current = get()
    await current
  } while (current !== get())
}

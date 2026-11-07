import { AsyncLocalStorage } from "node:async_hooks";

// Route bundles share this process-wide queue. Nested recovery in a correction
// keeps the same lock; another request must wait for the whole operation.
const KEY = Symbol.for("quran.ticket-correction.operation-lock");

export function withCorrectionLock(operation) {
  const state = globalThis[KEY] ||= {
    queue: Promise.resolve(),
    scope: new AsyncLocalStorage()
  };
  if (state.scope.getStore() === state) return operation();
  const task = state.queue.then(() => state.scope.run(state, operation));
  state.queue = task.then(() => undefined, () => undefined);
  return task;
}

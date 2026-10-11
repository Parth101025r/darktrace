// Tiny global event bus. Used so app-level events (critical threats, crawler
// state changes, tab switches) reach canvas effects without re-rendering them.
const listeners = new Set();

export const eventBus = {
  emit(type, payload) {
    listeners.forEach((fn) => fn({ type, payload }));
  },
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

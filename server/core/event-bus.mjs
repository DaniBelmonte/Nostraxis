export class EventBus {
  #listeners = new Set();
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  publish(message) { for (const listener of this.#listeners) listener(message); }
}

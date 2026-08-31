import { EventEmitter } from 'events';

// In-process pub/sub for live updates, keyed by topic (threadId by default).
// SSE endpoints subscribe to a topic and re-hydrate the authoritative state
// from the DB when an event arrives, so payloads here are intentionally light.
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function notify(topic, payload) {
  bus.emit(topic, payload);
}

export function subscribe(topic, handler) {
  bus.on(topic, handler);
  return () => bus.off(topic, handler);
}

export function hasSubscribers(topic) {
  return bus.listenerCount(topic) > 0;
}

export function _resetNotifierForTests() {
  bus.removeAllListeners();
}

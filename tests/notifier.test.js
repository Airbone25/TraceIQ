import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notify, subscribe, hasSubscribers, _resetNotifierForTests } from '../services/notifier.js';

describe('Notifier (in-process pub/sub)', () => {
  beforeEach(() => {
    _resetNotifierForTests();
  });

  it('should deliver a payload to a subscriber for the matching topic', () => {
    const handler = vi.fn();
    subscribe('t1', handler);
    notify('t1', { type: 'step' });
    expect(handler).toHaveBeenCalledWith({ type: 'step' });
  });

  it('should not deliver to subscribers of other topics', () => {
    const handler = vi.fn();
    subscribe('t1', handler);
    notify('t2', { type: 'status' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should stop delivering after unsubscribe', () => {
    const handler = vi.fn();
    const unsubscribe = subscribe('t1', handler);
    notify('t1', { type: 'step' });
    unsubscribe();
    notify('t1', { type: 'status' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should support multiple subscribers on the same topic', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe('t1', a);
    subscribe('t1', b);
    notify('t1', { type: 'step' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('should report whether a topic has subscribers', () => {
    expect(hasSubscribers('t1')).toBe(false);
    const unsubscribe = subscribe('t1', vi.fn());
    expect(hasSubscribers('t1')).toBe(true);
    unsubscribe();
    expect(hasSubscribers('t1')).toBe(false);
  });
});

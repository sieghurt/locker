import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Locker } from './api/types';
import { useLiveLockers } from './hooks';

const locker = (label: string, status: Locker['status']): Locker => ({
  id: `id-${label}`,
  label,
  size: 'SMALL',
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
  currentPackage: null,
});

const envelope = (items: Locker[]) =>
  new Response(
    JSON.stringify({ success: true, data: { items, total: items.length, limit: 500, offset: 0 } }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );

/** Minimal EventSource double: records listeners and lets the test fire open/error/events. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, EventListener[]>();
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }
  removeEventListener(type: string, cb: EventListener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== cb),
    );
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners.get(type) ?? [])
      cb({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe('useLiveLockers', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads the board, subscribes to the event stream, and refetches when an event arrives', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(envelope([locker('S-01', 'AVAILABLE')]))
      .mockResolvedValue(envelope([locker('S-01', 'OCCUPIED')]));

    const { result } = renderHook(() => useLiveLockers());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lockers[0].status).toBe('AVAILABLE');

    const source = FakeEventSource.instances[0];
    expect(source.url).toBe('/api/lockers/events');
    act(() => source.onopen?.());
    await waitFor(() => expect(result.current.status).toBe('live'));

    act(() =>
      source.emit('package.stored', {
        type: 'package.stored',
        at: '2026-01-01T00:00:01.000Z',
        lockerId: 'id-S-01',
        lockerLabel: 'S-01',
        lockerSize: 'SMALL',
        status: 'OCCUPIED',
        customerId: 'cust-1',
      }),
    );

    await waitFor(() => expect(result.current.lockers[0].status).toBe('OCCUPIED'));
    expect(result.current.feed).toHaveLength(1);
    expect(result.current.feed[0]).toMatchObject({ type: 'package.stored', lockerLabel: 'S-01' });
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('/api/lockers'))).toBe(
      true,
    );
  });

  it('falls back to polling when the stream errors, and reports it', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope([]));

    const { result } = renderHook(() => useLiveLockers());
    const source = FakeEventSource.instances[0];
    act(() => source.onerror?.());
    expect(result.current.status).toBe('polling');

    const before = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls
      .length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(
      (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBeGreaterThan(before);
    vi.useRealTimers();
  });

  it('closes the stream on unmount', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope([]));
    const { unmount } = renderHook(() => useLiveLockers());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('advances a revision on every load, in live and in polling mode', async () => {
    // A Response body can only be read once, so build a fresh one per call.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(envelope([])));
    const { result } = renderHook(() => useLiveLockers());
    await waitFor(() => expect(result.current.revision).toBe(1));

    const source = FakeEventSource.instances[0];
    act(() => source.onopen?.());
    await waitFor(() => expect(result.current.revision).toBe(2));

    // The feed is capped, so it cannot serve as a refetch key; the revision keeps moving regardless.
    act(() =>
      source.emit('package.stored', {
        type: 'package.stored',
        at: '2026-01-01T00:00:01.000Z',
        lockerId: 'id-S-01',
        lockerLabel: 'S-01',
        lockerSize: 'SMALL',
        status: 'OCCUPIED',
      }),
    );
    await waitFor(() => expect(result.current.revision).toBe(3));
  });

  it('reports an empty board while logged out, without leaking the previous session', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(envelope([locker('S-01', 'AVAILABLE')])),
    );
    const { result, rerender } = renderHook(({ on }: { on: boolean }) => useLiveLockers(on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.lockers).toHaveLength(1));

    rerender({ on: false });
    expect(result.current.lockers).toEqual([]);
    expect(result.current.feed).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});

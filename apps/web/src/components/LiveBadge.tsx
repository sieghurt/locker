import type { LiveStatus } from '../hooks';

const copy: Record<LiveStatus, { label: string; title: string }> = {
  connecting: { label: 'connecting…', title: 'Opening the live update stream' },
  live: { label: 'live', title: 'Updates are pushed by the server the moment a locker changes' },
  polling: {
    label: 'polling',
    title: 'Live stream unavailable; refreshing every 5 seconds instead',
  },
};

export function LiveBadge({ status }: { status: LiveStatus }) {
  return (
    <span className={`live-badge ${status}`} title={copy[status].title} data-testid="live-badge">
      <span className="dot" /> {copy[status].label}
    </span>
  );
}

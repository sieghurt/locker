import type { Locker } from '../api/types';

interface Props {
  lockers: Locker[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (locker: Locker) => void;
  hint?: string;
}

const sizeGlyph: Record<Locker['size'], string> = { SMALL: 'S', MEDIUM: 'M', LARGE: 'L' };

export function LockerBoard({ lockers, loading, error, selectedId, onSelect, hint }: Props) {
  const available = lockers.filter((l) => l.status === 'AVAILABLE').length;

  return (
    <section className="panel board" aria-labelledby="board-title">
      <header className="panel-header">
        <h2 id="board-title">Locker station</h2>
        <span className="muted" data-testid="availability">
          {loading ? 'Loading…' : `${available} of ${lockers.length} available`}
        </span>
      </header>

      {error && <p className="error">{error}</p>}
      {!loading && lockers.length === 0 && (
        <p className="muted">No lockers yet. Add some on the Station admin screen.</p>
      )}

      <ul className="grid" aria-label="lockers">
        {lockers.map((locker) => (
          <li key={locker.id}>
            <button
              type="button"
              className={`tile ${locker.status.toLowerCase()} ${selectedId === locker.id ? 'selected' : ''}`}
              onClick={() => onSelect(locker)}
              aria-pressed={selectedId === locker.id}
              title={`${locker.label} · ${locker.size} · ${locker.status}`}
            >
              <span className="tile-label">{locker.label}</span>
              <span className="tile-size">{sizeGlyph[locker.size]}</span>
              <span className="tile-status">
                {locker.status === 'OCCUPIED' && locker.currentPackage
                  ? locker.currentPackage.customerLabel
                  : 'free'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hint && <p className="hint">{hint}</p>}
    </section>
  );
}

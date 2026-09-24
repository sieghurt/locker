import type { Locker } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AgentPanel } from '../components/AgentPanel';
import { LockerBoard } from '../components/LockerBoard';

interface Props {
  lockers: Locker[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function AgentPage({ lockers, loading, error, refresh }: Props) {
  const { user } = useAuth();
  return (
    <div className="two-pane">
      <LockerBoard
        lockers={lockers}
        loading={loading}
        error={error}
        selectedId={null}
        onSelect={() => {}}
        hint="Availability updates live as agents store and customers collect."
      />
      <AgentPanel onStored={refresh} canRevealCode={user?.role === 'ADMIN'} />
    </div>
  );
}

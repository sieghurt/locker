import { useState } from 'react';

import type { Locker } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { CustomerPanel } from '../components/CustomerPanel';
import { LockerBoard } from '../components/LockerBoard';
import { MyAccount } from '../components/MyAccount';
import { MyPackages } from '../components/MyPackages';

interface Props {
  lockers: Locker[];
  loading: boolean;
  error: string | null;
  revision: number;
  refresh: () => void;
}

export function PickupPage({ lockers, loading, error, revision, refresh }: Props) {
  const { user } = useAuth();
  // "My packages" and "My account" belong to the signed-in customer; an admin on this screen is
  // helping someone at the kiosk and has their own views under Station admin.
  const isCustomer = user?.role === 'CUSTOMER';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = lockers.find((l) => l.id === selectedId) ?? null;
  // Any change to the board may mean a new package or a new charge for this customer.
  const version = revision;

  return (
    <div className="two-pane">
      <div className="stack">
        {isCustomer && (
          <>
            <MyPackages lockers={lockers} version={version} onPick={setSelectedId} />
            <MyAccount version={version} />
          </>
        )}
        <LockerBoard
          lockers={lockers}
          loading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={(l) => setSelectedId(l.id)}
          hint="Tap your locker, then enter the pickup code you received by email."
        />
      </div>
      {/* Keyed so choosing another locker clears the previous attempt's error or receipt. */}
      <CustomerPanel
        key={selectedId ?? 'none'}
        lockers={lockers}
        selectedLocker={selected}
        onSelectLocker={(l) => setSelectedId(l?.id ?? null)}
        onRetrieved={refresh}
      />
    </div>
  );
}

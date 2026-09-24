/**
 * The single size scale shared by lockers and packages. A package fits a locker whose rank is
 * greater than or equal to its own. Adding a size (e.g. EXTRA_LARGE) means: add the enum member,
 * give it a rank, and add the value to the `locker_size` Postgres enum in a migration.
 */
export enum LockerSize {
  SMALL = 'SMALL',
  MEDIUM = 'MEDIUM',
  LARGE = 'LARGE',
}

const SIZE_RANK: Readonly<Record<LockerSize, number>> = {
  [LockerSize.SMALL]: 1,
  [LockerSize.MEDIUM]: 2,
  [LockerSize.LARGE]: 3,
};

/** All sizes from smallest to largest: the allocation preference order. */
export const LOCKER_SIZES_ASCENDING: readonly LockerSize[] = Object.values(LockerSize).sort(
  (a, b) => SIZE_RANK[a] - SIZE_RANK[b],
);

export function rankOf(size: LockerSize): number {
  return SIZE_RANK[size];
}

export function canHold(lockerSize: LockerSize, packageSize: LockerSize): boolean {
  return rankOf(lockerSize) >= rankOf(packageSize);
}

/** Locker sizes that can hold a package of `packageSize`, smallest first. */
export function sizesThatCanHold(packageSize: LockerSize): LockerSize[] {
  return LOCKER_SIZES_ASCENDING.filter((lockerSize) => canHold(lockerSize, packageSize));
}

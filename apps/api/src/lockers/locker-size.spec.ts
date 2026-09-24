import {
  canHold,
  LOCKER_SIZES_ASCENDING,
  LockerSize,
  rankOf,
  sizesThatCanHold,
} from './locker-size';

describe('LockerSize', () => {
  it('orders sizes from smallest to largest', () => {
    expect(LOCKER_SIZES_ASCENDING).toEqual([LockerSize.SMALL, LockerSize.MEDIUM, LockerSize.LARGE]);
    expect(rankOf(LockerSize.SMALL)).toBeLessThan(rankOf(LockerSize.MEDIUM));
    expect(rankOf(LockerSize.MEDIUM)).toBeLessThan(rankOf(LockerSize.LARGE));
  });

  it.each([
    [LockerSize.SMALL, LockerSize.SMALL, true],
    [LockerSize.SMALL, LockerSize.MEDIUM, false],
    [LockerSize.MEDIUM, LockerSize.SMALL, true],
    [LockerSize.LARGE, LockerSize.LARGE, true],
    [LockerSize.MEDIUM, LockerSize.LARGE, false],
  ])('a %s locker holding a %s package -> %s', (locker, pkg, expected) => {
    expect(canHold(locker, pkg)).toBe(expected);
  });

  it('lists fitting locker sizes smallest first (the allocation preference)', () => {
    expect(sizesThatCanHold(LockerSize.SMALL)).toEqual([
      LockerSize.SMALL,
      LockerSize.MEDIUM,
      LockerSize.LARGE,
    ]);
    expect(sizesThatCanHold(LockerSize.MEDIUM)).toEqual([LockerSize.MEDIUM, LockerSize.LARGE]);
    expect(sizesThatCanHold(LockerSize.LARGE)).toEqual([LockerSize.LARGE]);
  });
});

import { LockerSeederService } from './locker-seeder.service';
import { LockerSize } from './locker-size';

describe('LockerSeederService.parse', () => {
  it('parses SIZE:COUNT pairs, ignoring whitespace and case', () => {
    expect(LockerSeederService.parse(' small:3, MEDIUM:2 ,Large:0')).toEqual([
      { size: LockerSize.SMALL, count: 3 },
      { size: LockerSize.MEDIUM, count: 2 },
      { size: LockerSize.LARGE, count: 0 },
    ]);
  });

  it('rejects unknown sizes and malformed counts', () => {
    expect(() => LockerSeederService.parse('HUGE:1')).toThrow(/Invalid SEED_LOCKERS/);
    expect(() => LockerSeederService.parse('SMALL:two')).toThrow(/Invalid SEED_LOCKERS/);
    expect(() => LockerSeederService.parse('SMALL:-1')).toThrow(/Invalid SEED_LOCKERS/);
  });
});

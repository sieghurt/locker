import { randomInt } from 'node:crypto';

/** Produces candidate pickup codes. Uniqueness is enforced by the database, not here. */
export abstract class PickupCodeGenerator {
  abstract generate(): string;
}

/** Cryptographically random, zero-padded numeric code of fixed length (kiosk keypad friendly). */
export class NumericPickupCodeGenerator extends PickupCodeGenerator {
  constructor(private readonly length: number) {
    super();
    if (!Number.isInteger(length) || length < 4 || length > 12) {
      throw new RangeError('pickup code length must be an integer between 4 and 12');
    }
  }

  generate(): string {
    // randomInt's upper bound is exclusive and must fit in a safe integer: 10^12 does.
    return randomInt(0, 10 ** this.length)
      .toString()
      .padStart(this.length, '0');
  }
}

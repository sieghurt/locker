export enum TransactionType {
  /** Storage billed when a package was collected. Increases what the customer owes. */
  CHARGE = 'CHARGE',
  /** Money received from the customer. Settles part of the balance. */
  PAYMENT = 'PAYMENT',
  /** A correction made by an admin, in either direction. */
  ADJUSTMENT = 'ADJUSTMENT',
}

export type LockerSize = 'SMALL' | 'MEDIUM' | 'LARGE';
export type LockerStatus = 'AVAILABLE' | 'OCCUPIED';

export const LOCKER_SIZES: LockerSize[] = ['SMALL', 'MEDIUM', 'LARGE'];

export interface AccruedCharge {
  amount: number;
  chargedDays: number;
  currency: string;
}

export interface CurrentPackage {
  id: string;
  size: LockerSize;
  /** Customer display name or masked email. */
  customerLabel: string;
  storedAt: string;
  /** What this package owes so far. Only sent to admins. */
  accruedCharge?: AccruedCharge;
}

export interface Locker {
  id: string;
  label: string;
  size: LockerSize;
  status: LockerStatus;
  createdAt: string;
  currentPackage: CurrentPackage | null;
}

export interface LockerList {
  items: Locker[];
  total: number;
  limit: number;
  offset: number;
}

export interface StoredPackage {
  packageId: string;
  lockerId: string;
  lockerLabel: string;
  lockerSize: LockerSize;
  packageSize: LockerSize;
  /** Present only when the caller is an admin; agents never receive it. */
  pickupCode?: string;
  storedAt: string;
  customer: { id: string; label: string };
  /** Whether the code was emailed to the customer. */
  notified: boolean;
}

export interface StorageChargeTier {
  tier: number;
  days: number;
  ratePerDay: number;
  amount: number;
}

export interface StorageCharge {
  currency: string;
  totalDays: number;
  freeDays: number;
  chargedDays: number;
  amount: number;
  breakdown: StorageChargeTier[];
}

export interface RetrievedPackage {
  packageId: string;
  lockerId: string;
  lockerLabel: string;
  lockerOpened: true;
  storedAt: string;
  retrievedAt: string;
  storageCharge: StorageCharge;
}

export type LockerEventType = 'locker.created' | 'package.stored' | 'package.retrieved';

/** Payload of the Server-Sent Events stream at GET /api/lockers/events. Never contains a pickup code. */
export interface LockerEvent {
  type: LockerEventType;
  at: string;
  lockerId: string;
  lockerLabel: string;
  lockerSize: LockerSize;
  status: LockerStatus;
  packageId?: string;
  customerLabel?: string;
}

export type UserRole = 'ADMIN' | 'AGENT' | 'CUSTOMER';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  displayName: string | null;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface CustomerSummary {
  id: string;
  label: string;
  maskedEmail: string;
}

export interface RevealedPickupCode {
  lockerLabel: string;
  customerLabel: string;
  pickupCode: string;
}

export interface DemoInfo {
  enabled: boolean;
  accounts: Array<{ email: string; role: UserRole; displayName: string | null }>;
}

export type PackageStatus = 'STORED' | 'RETRIEVED';

export interface PackageSummary {
  id: string;
  lockerId: string;
  size: LockerSize;
  customerUserId: string | null;
  status: PackageStatus;
  storedAt: string;
  retrievedAt: string | null;
  storageCharge: number | null;
  chargedDays: number | null;
  /** Running total while it waits, or what was charged once collected. */
  charge?: StorageCharge;
}

export type TransactionType = 'CHARGE' | 'PAYMENT' | 'ADJUSTMENT';

export interface Transaction {
  id: string;
  type: TransactionType;
  /** Signed: positive is owed by the customer, negative settles it. */
  amount: number;
  currency: string;
  description: string;
  packageId: string | null;
  occurredAt: string;
}

export interface Account {
  customerId: string;
  customerLabel: string;
  currency: string;
  balance: number;
  charged: number;
  paid: number;
  transactions: number;
}

export interface Statement {
  account: Account;
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
}

export interface ChargesSummary {
  currency: string;
  outstanding: { packages: number; amount: number };
  collected: { packages: number; amount: number };
}

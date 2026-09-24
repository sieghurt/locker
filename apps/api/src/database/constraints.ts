/**
 * Names of the constraints and indexes the application code relies on for error mapping and
 * retries. The migration uses the same constants, so a rename cannot silently break a 409 mapping.
 */
export const DB = {
  LOCKER_LABEL_UNIQUE: 'uq_lockers_label',
  ONE_STORED_PACKAGE_PER_LOCKER: 'ux_packages_one_stored_per_locker',
  ACTIVE_PICKUP_CODE_UNIQUE: 'ux_packages_active_pickup_code',
  USER_EMAIL_UNIQUE: 'uq_users_email',
} as const;

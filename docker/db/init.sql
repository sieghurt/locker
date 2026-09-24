-- Runs once when the postgres volume is first created.
-- The main database comes from POSTGRES_DB; this adds a separate one for the e2e suite
-- so tests can truncate freely without touching demo data.
CREATE DATABASE locker_test;

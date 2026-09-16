-- Production already has this value on a legacy leasing-admin payment row.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'LEASING';

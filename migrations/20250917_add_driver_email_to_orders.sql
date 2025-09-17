-- Migration: Add driver_email column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_email TEXT;
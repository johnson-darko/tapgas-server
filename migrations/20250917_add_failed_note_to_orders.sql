-- Migration: Add failed_note column to orders table
ALTER TABLE orders ADD COLUMN failed_note TEXT;
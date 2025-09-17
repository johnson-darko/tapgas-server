-- Migration: Create assigned_clusters table
CREATE TABLE IF NOT EXISTS assigned_clusters (
    id SERIAL PRIMARY KEY,
    driver_email VARCHAR(255) NOT NULL,
    order_ids TEXT[] NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Optional: Add index for faster lookups by driver
CREATE INDEX IF NOT EXISTS idx_assigned_clusters_driver_email ON assigned_clusters(driver_email);
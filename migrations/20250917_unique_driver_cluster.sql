-- Migration: Enforce uniqueness for (driver_email, order_ids) in assigned_clusters
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_driver_cluster
ON assigned_clusters (driver_email, order_ids);
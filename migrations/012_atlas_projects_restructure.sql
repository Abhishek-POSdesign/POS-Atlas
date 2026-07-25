-- Migration 012: Restructure Atlas Projects
-- Phase 2: Add short-term and long-term goal tracking

ALTER TABLE atlas_projects
  ADD COLUMN short_term_goal text,
  ADD COLUMN short_term_goal_date date,
  ADD COLUMN long_term_goal text,
  ADD COLUMN long_term_goal_date date;

-- Note: The following columns are intentionally retained for safety and zero data loss mid-deployment.
-- They are retired from the active entity shape and UI, and will be dropped in a future cleanup migration.
-- - current_focus
-- - next_step
-- - future_plans
-- - target_date

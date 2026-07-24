# Atlas Schema

This document details the Supabase database schema for the Atlas rebuild. 
All tables use the `atlas_` prefix.

## Tables

### `atlas_projects`
- `id` (uuid, pk)
- `name` (text, not null)
- `monogram_letter` (text, not null)
- `color_key` (text, not null)
- `description` (text)
- `current_focus` (text)
- `next_step` (text)
- `future_plans` (text)
- `status` (text, default 'planned')
- `started_at` (date, default now)
- `target_date` (date)
- `order_index` (integer, default 0)
- `cover_image_url` (text)
- `archived_at` (timestamptz)
- `deleted_at` (timestamptz)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

### `atlas_tasks`
- `id` (uuid, pk)
- `project_id` (uuid, fk to atlas_projects)
- `name` (text, not null)
- `status` (text, default 'not_started')
- `scheduled_date` (date)
- `scheduled_time` (time)
- `notify_enabled` (boolean, default false)
- `priority` (text, default 'normal')
- `completed_at` (timestamptz)
- `completion_note` (text)
- `archived_at` (timestamptz)
- `deleted_at` (timestamptz)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

*(For all tables, refer to `migrations/001_init.sql`)*

## Reliability Rules
- **deleted_at**: Soft delete only. Never hard delete outside the Restore view.
- **Timestamps**: All timestamps are handled server-side.
- **ID**: UUIDs everywhere. No numeric ID counters.

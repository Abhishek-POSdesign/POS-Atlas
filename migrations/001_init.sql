-- Migration 001: Initialize Atlas schema
-- Prefix: atlas_

CREATE TABLE atlas_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    monogram_letter TEXT NOT NULL,
    color_key TEXT NOT NULL,
    description TEXT,
    current_focus TEXT,
    next_step TEXT,
    future_plans TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    started_at DATE NOT NULL DEFAULT CURRENT_DATE,
    target_date DATE,
    order_index INTEGER NOT NULL DEFAULT 0,
    cover_image_url TEXT,
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE atlas_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES atlas_projects(id),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started',
    scheduled_date DATE,
    scheduled_time TIME,
    notify_enabled BOOLEAN NOT NULL DEFAULT false,
    priority TEXT NOT NULL DEFAULT 'normal',
    completed_at TIMESTAMPTZ,
    completion_note TEXT,
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE atlas_task_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES atlas_projects(id),
    task_id UUID REFERENCES atlas_tasks(id),
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    body TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE atlas_project_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES atlas_projects(id) NOT NULL,
    body TEXT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE atlas_notebook_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_date DATE NOT NULL,
    body TEXT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(entry_date)
);

CREATE TABLE atlas_checklist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    block TEXT NOT NULL,
    icon TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE atlas_checklist_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID REFERENCES atlas_checklist_items(id) NOT NULL,
    entry_date DATE NOT NULL,
    status TEXT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(item_id, entry_date)
);

CREATE TABLE atlas_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    goal_value INTEGER,
    current_value INTEGER NOT NULL DEFAULT 0,
    streak_start_date DATE,
    color_key TEXT NOT NULL,
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE atlas_target_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id UUID REFERENCES atlas_targets(id) NOT NULL,
    entry_date DATE NOT NULL,
    value_delta INTEGER NOT NULL,
    note TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS for all tables
ALTER TABLE atlas_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_task_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_project_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_notebook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_checklist_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_target_logs ENABLE ROW LEVEL SECURITY;

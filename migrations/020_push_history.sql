CREATE TABLE IF NOT EXISTS public.atlas_push_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.atlas_tasks(id) ON DELETE CASCADE,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure RLS is enabled
ALTER TABLE public.atlas_push_history ENABLE ROW LEVEL SECURITY;

-- Add index for fast lookup
CREATE INDEX IF NOT EXISTS idx_atlas_push_history_task_id ON public.atlas_push_history(task_id);

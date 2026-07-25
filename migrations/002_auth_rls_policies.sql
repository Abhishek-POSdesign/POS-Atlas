-- Migration 002: Require a real signed-in session on every atlas_ table.
-- Added 2026-07-25 per Abhishek's explicit request: real email+password login,
-- no anonymous access to any Atlas data. Single-tenant app (exactly one account
-- will ever exist), so "authenticated" alone is sufficient scoping -- no
-- profiles table or profile_id join needed, unlike the old app's pattern.

CREATE POLICY "authenticated_full_access" ON atlas_projects
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON atlas_tasks
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON atlas_task_logs
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON atlas_project_notes
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON atlas_notebook_entries
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON atlas_checklist_items
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON atlas_checklist_history
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON atlas_targets
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON atlas_target_logs
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

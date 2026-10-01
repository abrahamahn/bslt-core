-- 0904_tasks_rls.sql
--
-- Row-level security for the starter tasks table.
--
-- Depends on: 0800_tasks.sql, 0900_rls.sql

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_owner_isolation_policy ON tasks;
CREATE POLICY task_owner_isolation_policy ON tasks
FOR ALL TO authenticated
USING (owner_id = current_setting('app.user_id', true)::uuid)
WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

-- Migration 027: Atlas AI chat -- singleton enforcement.
-- atlas_ai_chat was created in migration 026 with the intent of holding
-- exactly one row (the whole chat history), but nothing at the schema
-- level enforced that. A duplicate insert would silently create a second
-- row, after which every subsequent AiChat.get() call (which uses
-- .maybeSingle()) would throw "multiple rows returned" and chat sync
-- would fail for the affected profile forever. The client-side push path
-- is now debounced and serialized (see aiConfig.js), which makes racing
-- inserts much less likely -- but "much less likely" is not a schema
-- guarantee. This partial-unique-index on a constant expression is
-- Postgres's standard pattern for enforcing a singleton row: because
-- `true` has the same value for every row, only one row can exist.

CREATE UNIQUE INDEX atlas_ai_chat_singleton ON atlas_ai_chat ((true));

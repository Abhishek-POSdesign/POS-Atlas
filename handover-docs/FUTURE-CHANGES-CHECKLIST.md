# Future-Changes Checklist

Before any future feature ships, run through these eight questions. If any answer surprises, stop and think before proceeding.

1. **Does it require a schema change?** → Add a numbered SQL migration. Never edit an existing one.
2. **Does it touch `db.js`?** → Which entity section? Are any other sections affected? Is the write still verified?
3. **Does it change a shared component?** → List every page that consumes that component. Manually test each after the change.
4. **Does it affect Today, Projects, Checklist, or Notebook?** → Manually test each affected tab end-to-end (create / edit / archive / delete / restore).
5. **Does it require migrating existing data?** → Write and rehearse the migration script on a copy. Verify per row. Approve before commit.
6. **Does it affect delete or archive behavior?** → Verify the three-state semantics (completed vs archived vs deleted) still hold. Restore still works. Nothing resurrects on refresh.
7. **Does it introduce background processes or hidden state?** → Justify why it's needed, or refuse. Default answer is refuse.
8. **Can it fail safely?** → What does Abhishek see when the write fails? Is the app still coherent? Is the change reversible?

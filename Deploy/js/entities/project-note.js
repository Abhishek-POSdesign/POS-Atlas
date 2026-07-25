// Reused for both page-level notes (project_id NULL, the Projects-page note
// area) and, if ever wanted again, a per-project note (project_id set) --
// see migrations/004_running_note_and_global_notes.sql. The UI currently
// only writes page-level notes (2026-07-25 testing feedback: a per-project
// notes section was redundant next to focus/next-step/tasks/future
// plans/work log already on that page).
export default {
    shapeVersion: 2,
    fields: {
        id: { type: 'uuid', system: true },
        project_id: { type: 'uuid', optional: true, editable: true },
        body: { type: 'text', required: true, editable: true },
        deleted_at: { type: 'timestamptz', optional: true, system: true },
        created_at: { type: 'timestamptz', system: true },
        updated_at: { type: 'timestamptz', system: true }
    },
    transitions: {
        delete: ['deleted_at'],
        restoreFromTrash: ['deleted_at']
    },
    requiredOnCreate: ['body']
};

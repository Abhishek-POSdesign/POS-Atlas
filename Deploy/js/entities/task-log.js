export default {
    shapeVersion: 1,
    fields: {
        id: { type: 'uuid', system: true },
        project_id: { type: 'uuid', optional: true },
        task_id: { type: 'uuid', optional: true },
        entry_date: { type: 'date', system: true },
        body: { type: 'text', required: true, editable: true },
        entry_type: { type: 'enum', values: ['narrative', 'task_completion'], required: true },
        deleted_at: { type: 'timestamptz', optional: true, system: true },
        created_at: { type: 'timestamptz', system: true },
        updated_at: { type: 'timestamptz', system: true }
    },
    transitions: {
        delete: ['deleted_at'],
        restoreFromTrash: ['deleted_at']
    },
    requiredOnCreate: ['body', 'entry_type']
};

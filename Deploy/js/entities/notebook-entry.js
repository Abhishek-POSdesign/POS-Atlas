export default {
    shapeVersion: 1,
    fields: {
        id: { type: 'uuid', system: true },
        entry_date: { type: 'date', required: true },
        body: { type: 'text', required: true, editable: true },
        deleted_at: { type: 'timestamptz', optional: true, system: true },
        created_at: { type: 'timestamptz', system: true },
        updated_at: { type: 'timestamptz', system: true }
    },
    transitions: {
        delete: ['deleted_at'],
        restoreFromTrash: ['deleted_at']
    },
    requiredOnCreate: ['entry_date', 'body']
};

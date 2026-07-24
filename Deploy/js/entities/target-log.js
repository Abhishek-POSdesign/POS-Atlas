export default {
    shapeVersion: 1,
    fields: {
        id: { type: 'uuid', system: true },
        target_id: { type: 'uuid', required: true },
        entry_date: { type: 'date', required: true },
        value_delta: { type: 'integer', required: true, editable: true },
        note: { type: 'text', optional: true, editable: true },
        deleted_at: { type: 'timestamptz', optional: true, system: true },
        created_at: { type: 'timestamptz', system: true },
        updated_at: { type: 'timestamptz', system: true }
    },
    transitions: {
        delete: ['deleted_at'],
        restoreFromTrash: ['deleted_at']
    },
    requiredOnCreate: ['target_id', 'entry_date', 'value_delta']
};

export default {
    shapeVersion: 1,
    fields: {
        id: { type: 'uuid', system: true },
        item_id: { type: 'uuid', required: true },
        entry_date: { type: 'date', required: true },
        status: { type: 'enum', values: ['done', 'skipped', 'holiday', 'missed'], required: true, editable: true },
        deleted_at: { type: 'timestamptz', optional: true, system: true },
        created_at: { type: 'timestamptz', system: true },
        updated_at: { type: 'timestamptz', system: true }
    },
    transitions: {
        status: ['done', 'skipped', 'holiday', 'missed'],
        delete: ['deleted_at'],
        restoreFromTrash: ['deleted_at']
    },
    requiredOnCreate: ['item_id', 'entry_date', 'status']
};

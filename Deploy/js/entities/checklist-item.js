export default {
    shapeVersion: 1,
    fields: {
        id: { type: 'uuid', system: true },
        name: { type: 'text', required: true, editable: true },
        block: { type: 'text', required: true, editable: true },
        icon: { type: 'text', optional: true, editable: true },
        order_index: { type: 'integer', system: true },
        active: { type: 'boolean', required: true, editable: true },
        archived_at: { type: 'timestamptz', optional: true, system: true },
        deleted_at: { type: 'timestamptz', optional: true, system: true },
        created_at: { type: 'timestamptz', system: true },
        updated_at: { type: 'timestamptz', system: true }
    },
    transitions: {
        archive: ['archived_at'],
        restoreFromArchive: ['archived_at'],
        delete: ['deleted_at'],
        restoreFromTrash: ['deleted_at']
    },
    requiredOnCreate: ['name', 'block']
};

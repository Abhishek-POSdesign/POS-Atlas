export default {
    shapeVersion: 1,
    fields: {
        id: { type: 'uuid', system: true },
        name: { type: 'text', required: true, editable: true },
        monogram_letter: { type: 'text', required: true, editable: true },
        color_key: { type: 'text', required: true, editable: true },
        description: { type: 'text', optional: true, editable: true },
        current_focus: { type: 'text', optional: true, editable: true },
        next_step: { type: 'text', optional: true, editable: true },
        future_plans: { type: 'text', optional: true, editable: true },
        status: { type: 'enum', values: ['planned', 'in_progress', 'completed'], required: true },
        started_at: { type: 'date', system: true },
        target_date: { type: 'date', optional: true, editable: true },
        order_index: { type: 'integer', system: true },
        cover_image_url: { type: 'text', optional: true, editable: true },
        archived_at: { type: 'timestamptz', optional: true, system: true },
        deleted_at: { type: 'timestamptz', optional: true, system: true },
        created_at: { type: 'timestamptz', system: true },
        updated_at: { type: 'timestamptz', system: true }
    },
    transitions: {
        status: ['planned', 'in_progress', 'completed'],
        archive: ['archived_at'],
        restoreFromArchive: ['archived_at'],
        delete: ['deleted_at'],
        restoreFromTrash: ['deleted_at']
    },
    requiredOnCreate: ['name', 'color_key']
};

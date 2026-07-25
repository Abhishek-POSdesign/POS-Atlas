export default {
    shapeVersion: 2,
    fields: {
        id: { type: 'uuid', system: true },
        name: { type: 'text', required: true, editable: true },
        monogram_letter: { type: 'text', required: true, editable: true },
        color_key: { type: 'text', required: true, editable: true },
        description: { type: 'text', optional: true, editable: true },
        short_term_goal: { type: 'text', optional: true, editable: true },
        short_term_goal_date: { type: 'date', optional: true, editable: true },
        long_term_goal: { type: 'text', optional: true, editable: true },
        long_term_goal_date: { type: 'date', optional: true, editable: true },
        status: { type: 'enum', values: ['planned', 'in_progress', 'completed'], required: true },
        started_at: { type: 'date', system: true },
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

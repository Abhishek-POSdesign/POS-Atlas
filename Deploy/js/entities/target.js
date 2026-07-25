export default {
    shapeVersion: 2,
    fields: {
        id: { type: 'uuid', system: true },
        name: { type: 'text', required: true, editable: true },
        kind: { type: 'enum', values: ['streak', 'count_toward_goal'], required: true },
        goal_value: { type: 'integer', optional: true, editable: true },
        current_value: { type: 'integer', system: true },
        streak_start_date: { type: 'date', optional: true, editable: true },
        previous_best_days: { type: 'integer', optional: true, system: true },
        grace_used: { type: 'boolean', required: true, system: true },
        color_key: { type: 'text', required: true, editable: true },
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
    requiredOnCreate: ['name', 'kind', 'color_key']
};

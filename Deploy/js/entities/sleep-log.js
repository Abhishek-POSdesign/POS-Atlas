export default {
    shapeVersion: 1,
    fields: {
        id: { type: 'uuid', system: true },
        entry_date: { type: 'date', required: true },
        duration_minutes: { type: 'integer', optional: true, editable: true },
        sleep_score: { type: 'integer', optional: true, editable: true },
        start_time: { type: 'time', optional: true, editable: true },
        deep_minutes: { type: 'integer', optional: true, editable: true },
        rem_minutes: { type: 'integer', optional: true, editable: true },
        light_minutes: { type: 'integer', optional: true, editable: true },
        awake_minutes: { type: 'integer', optional: true, editable: true },
        resting_hr: { type: 'integer', optional: true, editable: true },
        hrv: { type: 'numeric', optional: true, editable: true },
        note: { type: 'text', optional: true, editable: true },
        deleted_at: { type: 'timestamptz', optional: true, system: true },
        created_at: { type: 'timestamptz', system: true },
        updated_at: { type: 'timestamptz', system: true }
    },
    transitions: {
        delete: ['deleted_at'],
        restoreFromTrash: ['deleted_at']
    },
    requiredOnCreate: ['entry_date']
};

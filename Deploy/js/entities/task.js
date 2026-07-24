export default {
    shapeVersion: 1,
    fields: {
        id: { type: 'uuid', system: true },
        project_id: { type: 'uuid', optional: true, editable: true },
        name: { type: 'text', required: true, editable: true },
        status: { type: 'enum', values: ['not_started', 'in_progress', 'done'], required: true },
        scheduled_date: { type: 'date', optional: true, editable: true },
        scheduled_time: { type: 'time', optional: true, editable: true },
        notify_enabled: { type: 'boolean', required: true, editable: true },
        priority: { type: 'enum', values: ['normal', 'high'], required: true, editable: true },
        completed_at: { type: 'timestamptz', optional: true, system: true },
        completion_note: { type: 'text', optional: true, editable: true },
        archived_at: { type: 'timestamptz', optional: true, system: true },
        deleted_at: { type: 'timestamptz', optional: true, system: true },
        created_at: { type: 'timestamptz', system: true },
        updated_at: { type: 'timestamptz', system: true }
    },
    transitions: {
        status: ['not_started', 'in_progress', 'done'],
        archive: ['archived_at'],
        restoreFromArchive: ['archived_at'],
        delete: ['deleted_at'],
        restoreFromTrash: ['deleted_at']
    },
    requiredOnCreate: ['name']
};

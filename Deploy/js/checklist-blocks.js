// The four fixed time-of-day blocks a checklist item belongs to.
// "floating" also exists as a block value (used by the 3 retired items from
// the Phase 2 migration) but is intentionally not listed here -- those items
// are archived and never shown in the active display or the block picker.

export const BLOCKS = [
    { key: 'morning', label: 'Morning' },
    { key: 'afternoon', label: 'Afternoon' },
    { key: 'night', label: 'Night' },
    { key: 'sleep', label: 'Sleep' }
];

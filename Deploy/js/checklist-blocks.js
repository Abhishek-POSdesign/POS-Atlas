// The four fixed time-of-day blocks a checklist item belongs to.
// colorKey maps to Atlas's existing accent palette (the same sage/blue/
// lilac/coral used for Projects) via the .color-<key> classes already
// defined in components.css -- no new tokens introduced.
// "floating" also exists as a block value (used by the 3 retired items from
// the Phase 2 migration) but is intentionally not listed here -- those items
// are archived and never shown in the active display or the block picker.

export const BLOCKS = [
    { key: 'morning', label: 'Morning', icon: '🌅', colorKey: 'coral' },
    { key: 'afternoon', label: 'Afternoon', icon: '☀️', colorKey: 'blue' },
    { key: 'night', label: 'Night', icon: '🌙', colorKey: 'lilac' },
    { key: 'sleep', label: 'Sleep', icon: '😴', colorKey: 'sage' }
];

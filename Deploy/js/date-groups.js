// Small shared helper -- groups a list of rows by a date string, newest
// date first. Used by the work log and the Projects-page notes area so both
// share one grouped-by-date visual pattern instead of two similar-but-not-
// quite-the-same implementations.
export function groupByDate(items, dateOf) {
    const groups = new Map();
    for (const item of items) {
        const key = dateOf(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return [...groups.entries()]
        .map(([date, entries]) => ({ date, entries }))
        .sort((a, b) => b.date.localeCompare(a.date));
}

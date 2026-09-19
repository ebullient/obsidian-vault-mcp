/**
 * Canonical heading-name normalization shared by heading selection
 * (`NoteHandler`) and heading search (`MCPTools`), so both resolve a
 * heading name the same way.
 */
export function normalizeHeading(value: string): string {
    let decoded = value;
    try {
        decoded = decodeURIComponent(value);
    } catch {
        decoded = value.replace(/%20/g, " ");
    }
    return decoded
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, "") // drop punctuation
        .replace(/[\s_]+/g, "-"); // collapse spaces/underscores
}

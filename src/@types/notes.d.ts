export interface LinkRef {
    path: string;
    subpath?: string;
}

export interface OutlineEntry {
    text: string;
    level: number;
    line: number;
}

export interface NoteReadResult {
    content?: string;
    embeds?: LinkRef[];
    links?: LinkRef[];
    outline?: OutlineEntry[];
    frontmatter?: Record<string, unknown>;
    startLine?: number;
    endLine?: number;
    totalLines?: number;
    truncated?: boolean;
    sizeBytes?: number;
}

export interface FullTextSearchFile {
    fileId: string;
    fileName: string;
    filePath: string;
    groupName: string;
    content: string;
}

export interface FullTextSearchHit {
    id: string;
    fileId: string;
    fileName: string;
    filePath: string;
    groupName: string;
    lineNumber: number;
    lineText: string;
    preview: string;
    matchStart: number;
    matchEnd: number;
}

const PREVIEW_PREFIX_CHARS = 36;
const PREVIEW_SUFFIX_CHARS = 56;

interface Preview {
    text: string;
    start: number;
    end: number;
}

function makePreview(line: string, matchIndex: number, matchLength: number): Preview {
    const begin = Math.max(0, matchIndex - PREVIEW_PREFIX_CHARS);
    const finish = Math.min(line.length, matchIndex + matchLength + PREVIEW_SUFFIX_CHARS);

    const rawText = line.slice(begin, finish);
    const prefix = begin > 0 ? "…" : "";
    const suffix = finish < line.length ? "…" : "";
    const text = `${prefix}${rawText}${suffix}`;
    const start = prefix.length + (matchIndex - begin);

    return {
        text,
        start,
        end: start + matchLength,
    };
}

export function searchInFiles(
    files: FullTextSearchFile[],
    query: string,
    maxResults = 200,
): FullTextSearchHit[] {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return [];

    const hits: FullTextSearchHit[] = [];

    for (const file of files) {
        const lines = file.content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            const matchIndex = line.toLowerCase().indexOf(keyword);
            if (matchIndex < 0) continue;

            const preview = makePreview(line, matchIndex, keyword.length);
            hits.push({
                id: `${file.fileId}:${i + 1}:${matchIndex}`,
                fileId: file.fileId,
                fileName: file.fileName,
                filePath: file.filePath,
                groupName: file.groupName,
                lineNumber: i + 1,
                lineText: line,
                preview: preview.text,
                matchStart: preview.start,
                matchEnd: preview.end,
            });

            if (hits.length >= maxResults) {
                return hits;
            }
        }
    }

    return hits;
}

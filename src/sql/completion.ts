/**
 * SQL intelligence seam (ARCHITECTURE.md §5).
 * Phase 1: keyword-only fallback so the editor already completes offline.
 * Phase 4 implements parse-aware providers behind `CompletionProvider`.
 */

export interface CompletionItem {
  label: string;
  kind: "keyword" | "table" | "column" | "function" | "type";
}

export interface CompletionProvider {
  complete(prefix: string): CompletionItem[];
}

const KEYWORDS = (
  "select from where join on group by order having limit offset insert into values " +
  "update set delete create table index view drop alter add primary key foreign " +
  "references unique not null default as and or in is like between case when then " +
  "else end distinct count sum avg min max"
).split(" ");

const FUNCTIONS = ["count", "sum", "avg", "min", "max", "now", "coalesce", "lower", "upper"];

export const keywordProvider: CompletionProvider = {
  complete(prefix: string): CompletionItem[] {
    const p = prefix.toLowerCase();
    if (!p) {
      return KEYWORDS.map((k) => ({ label: k.toUpperCase(), kind: "keyword" as const }));
    }
    return [
      ...KEYWORDS.filter((k) => k.startsWith(p)).map((k) => ({
        label: k.toUpperCase(),
        kind: "keyword" as const,
      })),
      ...FUNCTIONS.filter((f) => f.startsWith(p)).map((f) => ({
        label: f,
        kind: "function" as const,
      })),
    ];
  },
};

/** Editor snippets: short triggers expanding to statement skeletons.
 *  Plain text with `${n:placeholder}` tab stops (Monaco snippet syntax).
 */

export interface Snippet {
  trigger: string;
  label: string;
  body: string;
}

export const SNIPPETS: Snippet[] = [
  {
    trigger: "sel",
    label: "SELECT … FROM … WHERE",
    body: "SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition};",
  },
  {
    trigger: "ct",
    label: "CREATE TABLE",
    body: "CREATE TABLE ${1:name} (\n    ${2:id} ${3:INTEGER PRIMARY KEY}\n);",
  },
  {
    trigger: "join",
    label: "SELECT with JOIN",
    body: "SELECT ${1:a.*}\nFROM ${2:table_a} ${3:a}\nJOIN ${4:table_b} ${5:b} ON ${6:b.id} = ${3:a}.${7:id};",
  },
  {
    trigger: "ins",
    label: "INSERT INTO … VALUES",
    body: "INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values});",
  },
  {
    trigger: "upd",
    label: "UPDATE … WHERE",
    body: "UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};",
  },
];

/** Snippets whose trigger starts with `prefix` (empty prefix → none). */
export function snippetsFor(prefix: string): Snippet[] {
  const p = prefix.toLowerCase();
  if (!p) return [];
  return SNIPPETS.filter((s) => s.trigger.startsWith(p));
}

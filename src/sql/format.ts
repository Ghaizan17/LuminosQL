/** Small opinionated SQL formatter: uppercase keywords, one major clause per
 *  line, continuation indent. Idempotent — running twice changes nothing.
 */

const CLAUSES = [
  "select distinct",
  "select",
  "from",
  "where",
  "group by",
  "having",
  "order by",
  "limit",
  "offset",
  "union all",
  "union",
  "insert into",
  "values",
  "update",
  "set",
  "delete from",
];

const MINOR_KEYWORDS = [
  "join", "on", "and", "or", "as", "asc", "desc", "by", "distinct", "all",
  "not", "null", "in", "is", "like", "between", "case", "when", "then",
  "else", "end", "left", "right", "full", "inner", "outer", "cross",
];

interface Token {
  text: string;
  quoted: boolean;
}

function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  const re = /('(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|--.*$|\/\*[\s\S]*?\*\/|\s+|[(),;]|[^\s(),;]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const text = m[0];
    if (/^\s+$/.test(text)) continue;
    out.push({ text, quoted: /^['"`]/.test(text) || text.startsWith("--") || text.startsWith("/*") });
  }
  return out;
}

/** A JOIN phrase: JOIN | [LEFT|RIGHT|FULL|INNER|CROSS] [OUTER] JOIN. */
function joinPhrase(tokens: Token[], i: number): string | null {
  const words: string[] = [];
  for (let j = i; j < Math.min(i + 3, tokens.length); j++) {
    const t = tokens[j];
    if (t.quoted) break;
    words.push(t.text.toLowerCase());
    if (words[words.length - 1] === "join") {
      const phrase = words.join(" ");
      if (/^(join|(left|right|full|inner|cross)( outer)? join)$/.test(phrase)) {
        return words.map((w) => w.toUpperCase()).join(" ");
      }
      return null;
    }
    if (!["left", "right", "full", "inner", "cross", "outer"].includes(words[words.length - 1])) {
      return null;
    }
  }
  return null;
}

export function formatSql(sql: string): string {
  const tokens = tokenize(sql.replace(/\(/g, " ( "));
  const lines: string[] = [];
  let current = "";

  const push = () => {
    if (current.trim()) lines.push(current.trim());
    current = "";
  };
  const append = (word: string) => {
    current += (current && !current.endsWith("(") ? " " : "") + word;
  };

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.quoted) {
      const join = joinPhrase(tokens, i);
      if (join) {
        push();
        current = join;
        i += join.split(" ").length;
        continue;
      }
      const two = `${t.text} ${(tokens[i + 1]?.quoted ? "" : tokens[i + 1]?.text ?? "").trim()}`.trim().toLowerCase();
      const clause = CLAUSES.find((c) => c === t.text.toLowerCase() || c === two);
      if (clause) {
        push();
        current = clause.toUpperCase();
        i += clause.includes(" ") ? 2 : 1;
        continue;
      }
    }
    if (t.text === "(") {
      append("(");
      i++;
      continue;
    }
    if (t.text === ")") {
      current += ")";
      i++;
      continue;
    }
    if (t.text === ",") {
      current += ",";
      push();
      i++;
      continue;
    }
    if (t.text === ";") {
      current += ";";
      push();
      i++;
      continue;
    }
    const word = t.quoted
      ? t.text
      : MINOR_KEYWORDS.includes(t.text.toLowerCase())
        ? t.text.toUpperCase()
        : t.text;
    append(word);
    i++;
  }
  push();
  return `${lines.join("\n").trim()}\n`;
}

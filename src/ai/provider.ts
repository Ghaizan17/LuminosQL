/** Optional AI seam. The app is fully useful without any provider; every
 *  capability degrades to an honest offline answer (see `offline.ts`).
 */

export interface AiContext {
  /** `schema.table` names the provider may reference. */
  tables: string[];
  engine: string;
}

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  generateSql(nl: string, ctx: AiContext): Promise<string>;
  explainSql(sql: string, ctx: AiContext): Promise<string>;
  explainError(title: string, causes: string[]): Promise<string>;
}

export class AiUnavailable extends Error {
  constructor(message: string) {
    super(message);
  }
}

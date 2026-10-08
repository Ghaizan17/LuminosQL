/** Mirror of `luminosql-core` connection types (JSON over Tauri IPC). */

export type Engine = "postgres" | "mysql" | "sqlite";

export interface ConnectionProfile {
  id: string;
  name: string;
  engine: Engine;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
}

export interface ServerInfo {
  engine: string;
  version: string;
  latency_ms: number;
}

export interface FriendlyError {
  title: string;
  causes: string[];
  code: string;
}

export interface ConnectionView {
  profile: ConnectionProfile;
  live: boolean;
}

export const ENGINE_DEFAULT_PORT: Record<Engine, number> = {
  postgres: 5432,
  mysql: 3306,
  sqlite: 0,
};

export function blankProfile(engine: Engine): ConnectionProfile {
  return {
    id: "",
    name: "",
    engine,
    host: engine === "sqlite" ? "" : "127.0.0.1",
    port: ENGINE_DEFAULT_PORT[engine],
    database: engine === "sqlite" ? "" : engine === "postgres" ? "postgres" : "test",
    username: "",
    ssl: false,
  };
}

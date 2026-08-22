import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import type { PersistedSnapshot } from './protocol';

const EMPTY_SNAPSHOT: PersistedSnapshot = {
  version: 1,
  sessions: [],
  matches: [],
};

export type SnapshotStore = {
  load(): Promise<PersistedSnapshot>;
  save(snapshot: PersistedSnapshot): void;
  flush(): Promise<void>;
  close?(): Promise<void>;
};

export function createSnapshotStore(filePath: string, databaseUrl?: string): SnapshotStore {
  if (databaseUrl?.trim()) return new PostgresStore(databaseUrl);
  return new JsonStore(filePath);
}

export class JsonStore implements SnapshotStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<PersistedSnapshot> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedSnapshot>;
      if (parsed.version !== 1 || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.matches)) {
        return EMPTY_SNAPSHOT;
      }
      return parsed as PersistedSnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_SNAPSHOT;
      console.error('Unable to load persisted data:', error);
      return EMPTY_SNAPSHOT;
    }
  }

  save(snapshot: PersistedSnapshot): void {
    const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, payload, 'utf8');
      })
      .catch((error) => {
        console.error('Unable to persist data:', error);
      });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }
}

export class PostgresStore implements SnapshotStore {
  private readonly pool: Pool;
  private readonly initialized: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
    this.pool.on('error', (error) => {
      console.error('Unexpected PostgreSQL connection error:', error);
    });
    this.initialized = this.initialize();
  }

  async load(): Promise<PersistedSnapshot> {
    await this.initialized;
    const result = await this.pool.query<{ snapshot: unknown }>(
      'SELECT snapshot FROM a_duel_snapshots WHERE id = 1',
    );
    const snapshot = result.rows[0]?.snapshot;
    return isPersistedSnapshot(snapshot) ? snapshot : EMPTY_SNAPSHOT;
  }

  save(snapshot: PersistedSnapshot): void {
    const payload = JSON.stringify(snapshot);
    this.writeQueue = this.writeQueue
      .then(async () => {
        await this.initialized;
        await this.pool.query(
          `INSERT INTO a_duel_snapshots (id, snapshot, updated_at)
           VALUES (1, $1::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE
           SET snapshot = EXCLUDED.snapshot, updated_at = EXCLUDED.updated_at`,
          [payload],
        );
      })
      .catch((error) => {
        console.error('Unable to persist data to PostgreSQL:', error);
      });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async close(): Promise<void> {
    await this.flush();
    await this.pool.end();
  }

  private async initialize(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS a_duel_snapshots (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        snapshot JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );
  }
}

function isPersistedSnapshot(value: unknown): value is PersistedSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<PersistedSnapshot>;
  return snapshot.version === 1 && Array.isArray(snapshot.sessions) && Array.isArray(snapshot.matches);
}

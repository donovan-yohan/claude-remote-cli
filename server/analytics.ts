import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Router } from 'express';
import type { Request, Response } from 'express';

let db: Database.Database | null = null;
let insertStmt: Database.Statement | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  category    TEXT NOT NULL,  -- 'session', 'ui', 'agent', 'navigation', 'workspace'
  action      TEXT NOT NULL,
  target      TEXT,
  properties  TEXT,
  session_id  TEXT,
  device      TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_category_action ON events(category, action);
CREATE INDEX IF NOT EXISTS idx_events_target ON events(target);
`;

const INSERT_SQL = 'INSERT INTO events (category, action, target, properties, session_id, device) VALUES (?, ?, ?, ?, ?, ?)';

export interface AnalyticsEvent {
  category: string;
  action: string;
  target?: string;
  properties?: Record<string, unknown>;
  session_id?: string;
  device?: string;
}

export function initAnalytics(configDir: string): void {
  const dbPath = path.join(configDir, 'analytics.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  insertStmt = db.prepare(INSERT_SQL);
}

export function closeAnalytics(): void {
  if (db) {
    db.close();
    db = null;
    insertStmt = null;
  }
}

function runInsert(stmt: Database.Statement, event: AnalyticsEvent): void {
  stmt.run(
    event.category,
    event.action,
    event.target ?? null,
    event.properties ? JSON.stringify(event.properties) : null,
    event.session_id ?? null,
    event.device ?? null,
  );
}

export function trackEvent(event: AnalyticsEvent): void {
  if (!insertStmt) return;
  try {
    runInsert(insertStmt, event);
  } catch {
    // Analytics write failure is non-fatal
  }
}

export function getDbPath(configDir: string): string {
  return path.join(configDir, 'analytics.db');
}

export function getDbSize(configDir: string): number {
  try {
    return fs.statSync(getDbPath(configDir)).size;
  } catch {
    return 0;
  }
}

export function createAnalyticsRouter(configDir: string): Router {
  const router = Router();

  // POST /analytics/events — batch ingest from frontend
  router.post('/events', (req: Request, res: Response) => {
    const { events } = req.body as { events?: AnalyticsEvent[] };
    if (!Array.isArray(events)) {
      res.status(400).json({ error: 'events array required' });
      return;
    }

    if (!db || !insertStmt) {
      res.status(503).json({ error: 'Analytics not initialized' });
      return;
    }

    const stmt = insertStmt;
    const insertMany = db.transaction((evts: AnalyticsEvent[]) => {
      let inserted = 0;
      for (const evt of evts) {
        if (!evt.category || !evt.action) continue;
        runInsert(stmt, evt);
        inserted++;
      }
      return inserted;
    });

    try {
      const inserted = insertMany(events);
      res.json({ ok: true, count: inserted });
    } catch {
      res.status(500).json({ error: 'Failed to write events' });
    }
  });

  // GET /analytics/size — DB file size in bytes
  router.get('/size', (_req: Request, res: Response) => {
    res.json({ bytes: getDbSize(configDir) });
  });

  // DELETE /analytics/events — truncate events table
  router.delete('/events', (_req: Request, res: Response) => {
    if (!db) {
      res.status(503).json({ error: 'Analytics not initialized' });
      return;
    }
    try {
      db.exec('DELETE FROM events');
      db.exec('VACUUM');
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to clear analytics' });
    }
  });

  return router;
}

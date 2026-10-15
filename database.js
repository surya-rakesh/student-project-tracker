import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const STATUSES = ['Planned', 'In Progress', 'Completed'];

// Creates (or opens) a SQLite database and returns the storage API.
// Parameterized prepared statements are used for every operation.
export function createDatabase(file = process.env.DB_FILE || 'data/projects.db') {
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);
  connection.exec(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    status TEXT NOT NULL CHECK(status IN ('Planned', 'In Progress', 'Completed'))
  )`);

  const listStmt = connection.prepare('SELECT id, name, status FROM projects ORDER BY id DESC');
  const getStmt = connection.prepare('SELECT id, name, status FROM projects WHERE id = ?');
  const insertStmt = connection.prepare('INSERT INTO projects (name, status) VALUES (?, ?)');
  const updateStmt = connection.prepare('UPDATE projects SET name = ?, status = ? WHERE id = ?');
  const deleteStmt = connection.prepare('DELETE FROM projects WHERE id = ?');

  return {
    async list() { return listStmt.all(); },
    async create({ name, status }) {
      const result = insertStmt.run(name, status);
      return getStmt.get(Number(result.lastInsertRowid));
    },
    async update(id, { name, status }) {
      const result = updateStmt.run(name, status, id);
      return result.changes ? getStmt.get(id) : null;
    },
    async remove(id) { return deleteStmt.run(id).changes > 0; },
    close() { connection.close(); }
  };
}

// ---------- Hosted Postgres backend (used on Vercel when DATABASE_URL is set) ----------
// `sql` is a tagged-template query function, e.g. from @neondatabase/serverless.
const MAX_INT4 = 2147483647; // the id column is a Postgres SERIAL (int4)

export async function createPostgresDatabase(sql) {
  await sql`CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    status TEXT NOT NULL CHECK(status IN ('Planned', 'In Progress', 'Completed'))
  )`;
  return {
    async list() { return sql`SELECT id, name, status FROM projects ORDER BY id DESC`; },
    async create({ name, status }) {
      const rows = await sql`INSERT INTO projects (name, status) VALUES (${name}, ${status}) RETURNING id, name, status`;
      return rows[0];
    },
    async update(id, { name, status }) {
      if (id > MAX_INT4) return null;
      const rows = await sql`UPDATE projects SET name = ${name}, status = ${status} WHERE id = ${id} RETURNING id, name, status`;
      return rows[0] ?? null;
    },
    async remove(id) {
      if (id > MAX_INT4) return false;
      const rows = await sql`DELETE FROM projects WHERE id = ${id} RETURNING id`;
      return rows.length > 0;
    },
    close() {}
  };
}

async function connect() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    return createPostgresDatabase(neon(url));
  }
  if (process.env.VERCEL) {
    throw new Error('DATABASE_URL is not set. Add a Postgres database to this Vercel project (Storage tab).');
  }
  return createDatabase(); // local development: SQLite at data/projects.db (or DB_FILE)
}

// Default database used by server.js and the Vercel entry (api/index.js).
// - DATABASE_URL set  -> hosted Postgres (required on Vercel, whose filesystem is read-only)
// - otherwise         -> local SQLite file (data/projects.db or DB_FILE)
// Opened lazily so importing this module has no side effects (tests rely on this).
let pending;
function getDefault() {
  pending ??= (async () => {
    const url = process.env.DATABASE_URL;
    if (url) {
      const { createPostgresDatabase } = await import('./database-postgres.js');
      return createPostgresDatabase(url);
    }
    if (process.env.VERCEL) {
      throw new Error('DATABASE_URL is not set. Vercel needs a hosted database (see README).');
    }
    return createDatabase();
  })();
  pending.catch(() => { pending = undefined; }); // allow retry after a failed start
  return pending;
}
export const db = {
  async list() { return (await getDefault()).list(); },
  async create(project) { return (await getDefault()).create(project); },
  async update(id, project) { return (await getDefault()).update(id, project); },
  async remove(id) { return (await getDefault()).remove(id); }
};

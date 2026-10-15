import { neon } from '@neondatabase/serverless';

// Hosted Postgres storage (used on Vercel when DATABASE_URL is set).
// Same interface as the SQLite storage in database.js. All queries are parameterized.
export async function createPostgresDatabase(url) {
  const sql = neon(url);
  await sql.query(`CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    status TEXT NOT NULL CHECK (status IN ('Planned', 'In Progress', 'Completed'))
  )`);
  return {
    async list() { return sql.query('SELECT id, name, status FROM projects ORDER BY id DESC'); },
    async create({ name, status }) {
      const rows = await sql.query('INSERT INTO projects (name, status) VALUES ($1, $2) RETURNING id, name, status', [name, status]);
      return rows[0];
    },
    async update(id, { name, status }) {
      const rows = await sql.query('UPDATE projects SET name = $1, status = $2 WHERE id = $3 RETURNING id, name, status', [name, status, id]);
      return rows[0] ?? null;
    },
    async remove(id) {
      const rows = await sql.query('DELETE FROM projects WHERE id = $1 RETURNING id', [id]);
      return rows.length > 0;
    },
    close() {}
  };
}

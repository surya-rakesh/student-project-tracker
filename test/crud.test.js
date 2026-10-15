import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createApp } from '../app.js';
import { createDatabase } from '../database.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const directory = mkdtempSync(join(tmpdir(), 'tracker-test-'));
const send = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---------- In-process API tests (isolated temporary database) ----------
const db = createDatabase(join(directory, 'api.db'));
const server = createApp(db).listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;
const api = `${base}/api/projects`;

test.after(() => {
  server.close();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

test('health endpoint returns {"ok":true}', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('initial project list is an array', async () => {
  const res = await fetch(api);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
});

test('POST creates a project (201) and trims the name', async () => {
  const res = await fetch(api, send('POST', { name: "  IoT Monitor's test  ", status: 'Planned' }));
  assert.equal(res.status, 201);
  const row = await res.json();
  assert.equal(typeof row.id, 'number');
  assert.equal(row.name, "IoT Monitor's test");
  assert.equal(row.status, 'Planned');
});

test('invalid input is rejected with 400', async () => {
  const bad = [
    { name: '', status: 'Planned' },
    { name: '   ', status: 'Planned' },
    { name: 'x'.repeat(81), status: 'Planned' },
    { name: 'Valid', status: 'Unknown' },
    { name: 'Valid' },
    { status: 'Planned' },
    { name: 42, status: 'Planned' }
  ];
  for (const body of bad) {
    assert.equal((await fetch(api, send('POST', body))).status, 400, JSON.stringify(body));
  }
  assert.equal((await fetch(api, send('POST', { name: 'x'.repeat(80), status: 'Completed' }))).status, 201);
});

test('SQL-looking input is stored as plain text', async () => {
  const name = "Robert'); DROP TABLE projects;--";
  const created = await (await fetch(api, send('POST', { name, status: 'Planned' }))).json();
  assert.equal(created.name, name);
  assert.ok((await (await fetch(api)).json()).length > 0);
});

test('PUT changes a project and preserves its ID', async () => {
  const row = await (await fetch(api, send('POST', { name: 'Original', status: 'Planned' }))).json();
  const before = (await (await fetch(api)).json()).length;
  const res = await fetch(`${api}/${row.id}`, send('PUT', { name: ' Smart Home ', status: 'Completed' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: row.id, name: 'Smart Home', status: 'Completed' });
  assert.equal((await (await fetch(api)).json()).length, before); // no duplicate
  assert.equal((await fetch(`${api}/${row.id}`, send('PUT', { name: '', status: 'Planned' }))).status, 400);
});

test('invalid IDs produce 400', async () => {
  for (const id of ['0', '-1', 'abc', '1.5', '1e3']) {
    assert.equal((await fetch(`${api}/${id}`, { method: 'DELETE' })).status, 400, `DELETE ${id}`);
    assert.equal((await fetch(`${api}/${id}`, send('PUT', { name: 'A', status: 'Planned' }))).status, 400, `PUT ${id}`);
  }
});

test('updating or deleting a nonexistent project produces 404', async () => {
  assert.equal((await fetch(`${api}/999999`, send('PUT', { name: 'Missing', status: 'Planned' }))).status, 404);
  assert.equal((await fetch(`${api}/999999`, { method: 'DELETE' })).status, 404);
});

test('DELETE removes only the selected project; repeat delete is 404', async () => {
  const a = await (await fetch(api, send('POST', { name: 'Keep me', status: 'Planned' }))).json();
  const b = await (await fetch(api, send('POST', { name: 'Remove me', status: 'In Progress' }))).json();
  const res = await fetch(`${api}/${b.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: true });
  const ids = (await (await fetch(api)).json()).map(p => p.id);
  assert.ok(ids.includes(a.id));
  assert.ok(!ids.includes(b.id));
  assert.equal((await fetch(`${api}/${b.id}`, { method: 'DELETE' })).status, 404);
});

test('malformed and oversized JSON are rejected with JSON errors', async () => {
  const malformed = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'Invalid JSON.');
  const huge = await fetch(api, send('POST', { name: 'x'.repeat(20000), status: 'Planned' }));
  assert.equal(huge.status, 413);
  assert.ok((await huge.json()).error);
});

test('unknown API routes return a JSON 404', async () => {
  const res = await fetch(`${base}/api/unknown`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /json/);
  assert.ok((await res.json()).error);
});

test('static frontend files are served with the required ids', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /Student Project Tracker/);
  for (const id of ['project-form', 'name', 'status', 'save-button', 'cancel-button', 'form-title', 'message', 'empty-state', 'project-list']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.equal((await fetch(`${base}/style.css`)).status, 200);
  assert.equal((await fetch(`${base}/script.js`)).status, 200);
});

// ---------- Real server process: persistence across restarts ----------
test('data survives a server restart (real server.js process, DB_FILE)', async () => {
  const port = 3198;
  const env = { ...process.env, PORT: String(port), DB_FILE: join(directory, 'restart.db') };
  let child;
  const start = async () => {
    child = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) return; } catch {}
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('Server did not start.');
  };
  const stop = () => new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  });
  const url = `http://localhost:${port}/api/projects`;
  try {
    await start();
    assert.deepEqual(await (await fetch(url)).json(), []);
    const row = await (await fetch(url, send('POST', { name: 'Persist me', status: 'Planned' }))).json();
    await fetch(`${url}/${row.id}`, send('PUT', { name: 'Smart Home', status: 'Completed' }));
    await stop();
    await start();
    assert.deepEqual(await (await fetch(url)).json(), [{ id: row.id, name: 'Smart Home', status: 'Completed' }]);
    assert.equal((await fetch(`${url}/${row.id}`, { method: 'DELETE' })).status, 200);
    await stop();
    await start();
    assert.deepEqual(await (await fetch(url)).json(), []);
  } finally {
    await stop();
  }
});

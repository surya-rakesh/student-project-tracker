import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');
const STATUSES = ['Planned', 'In Progress', 'Completed'];

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(publicDir));

  // Wraps async handlers so rejected promises reach the error handler (Express 5 also does this).
  const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

  function readId(req, res) {
    const raw = req.params.id;
    const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: 'Invalid project id.' });
      return null;
    }
    return id;
  }

  function readProject(req, res) {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const status = req.body?.status;
    if (name.length < 1 || name.length > 80 || !STATUSES.includes(status)) {
      res.status(400).json({ error: 'Use a name of 1-80 characters and a valid status.' });
      return null;
    }
    return { name, status };
  }

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.get('/api/projects', wrap(async (req, res) => res.json(await db.list())));

  app.post('/api/projects', wrap(async (req, res) => {
    const project = readProject(req, res);
    if (project) res.status(201).json(await db.create(project));
  }));

  app.put('/api/projects/:id', wrap(async (req, res) => {
    const id = readId(req, res); if (id === null) return;
    const project = readProject(req, res); if (!project) return;
    const row = await db.update(id, project);
    if (!row) return res.status(404).json({ error: 'Project not found.' });
    res.json(row);
  }));

  app.delete('/api/projects/:id', wrap(async (req, res) => {
    const id = readId(req, res); if (id === null) return;
    if (!await db.remove(id)) return res.status(404).json({ error: 'Project not found.' });
    res.json({ deleted: true });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    console.error('Request failed:', error.code || error.name, error.message);
    res.status(500).json({ error: 'Server error. Check the server terminal.' });
  });

  return app;
}

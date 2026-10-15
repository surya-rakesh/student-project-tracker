# Student Project Tracker

A complete full-stack tracker for electronics and engineering project ideas.
Add, view, edit and delete projects. Records are stored in a SQLite database, so they survive browser refreshes and server restarts.

Local demo only: no login, accounts or multi-user isolation.

## Stack
- Frontend: HTML5, CSS3, vanilla JavaScript (`public/`)
- Backend: Node.js (ES modules) + Express 5.1.0 REST API returning JSON
- Database: SQLite via Node's built-in `node:sqlite` (`DatabaseSync`), stored in `data/projects.db`
- Tests: Node's built-in test runner (`node:test`)

## Run (Windows, VS Code + PowerShell)
Use Node.js 22.x (tested baseline 22.23.3; `package.json` requires `>=22.18.0 <23`). Open a PowerShell terminal in this folder:

```powershell
npm.cmd install
npm.cmd start
```

Open http://localhost:3000. Keep the server terminal running; stop it with Ctrl+C.
`data/projects.db` is created automatically on first start. Locally no database setup is needed: SQLite is used when `DATABASE_URL` is not set.

## Deploy to Vercel
Vercel's filesystem is read-only, so a SQLite file cannot store data there. On Vercel the app uses a hosted Postgres database instead (same API, same validation). Locally nothing changes.

1. Run `npm.cmd install` once locally (this updates `package-lock.json` for the Postgres driver), then commit and push to GitHub.
2. In Vercel: **Add New > Project**, import the repo. Leave the build settings as they are (`vercel.json` already sets the output folder to `public` and routes `/api/*` to `api/index.js`).
3. In the Vercel project: **Storage > Create / Connect a Postgres database** (Neon from the Marketplace). This adds a `DATABASE_URL` environment variable. Any Postgres connection string works if you set `DATABASE_URL` yourself.
4. Redeploy. The `projects` table is created automatically on first request.
5. Check `https://<your-app>.vercel.app/api/health` returns `{"ok":true}`, then use the site.

If `DATABASE_URL` is missing on Vercel, the API returns a 500 and the function log says `DATABASE_URL is not set`.

You can also point your local copy at the hosted database by putting `DATABASE_URL=...` in your environment (see `.env.example`); `.env` files are git-ignored.

## Test
```powershell
npm.cmd test
```
The tests use a temporary database (via `DB_FILE`), so your real `data/projects.db` is never touched.

## Files
| File | Purpose |
|---|---|
| `server.js` | Starts the server on `PORT` (default 3000) |
| `app.js` | `createApp(db)`: REST routes, validation, static files, error handling |
| `database.js` | Chooses storage; SQLite implementation: `list`, `create`, `update`, `remove` (prepared statements) |
| `database-postgres.js` | Postgres storage used when `DATABASE_URL` is set (Vercel) |
| `api/index.js`, `vercel.json` | Vercel serverless entry and routing |
| `public/index.html`, `style.css`, `script.js` | The user interface |
| `test/crud.test.js` | Integration tests |

## API
| Method | Path | Result |
|---|---|---|
| GET | `/api/health` | 200 `{"ok":true}` |
| GET | `/api/projects` | 200 array of `{id, name, status}` (newest first) |
| POST | `/api/projects` | 201 created record; 400 invalid input |
| PUT | `/api/projects/:id` | 200 updated record; 400 invalid id/input; 404 not found |
| DELETE | `/api/projects/:id` | 200 `{"deleted":true}`; 400 invalid id; 404 not found |

Name: 1-80 characters after trimming. Status: `Planned`, `In Progress` or `Completed`.
Malformed JSON returns 400; bodies over 10 KB return 413; unknown `/api` routes return a JSON 404.

## Evidence
Project data lives only in `data/projects.db` (SQLite). A browser refresh just reloads from the API; a server restart reopens the same file. This is verified by `npm.cmd test`, which restarts a real server process and checks the data is still there. Older browser-local (localStorage) records are not migrated; recreate them if needed.

## GitHub
Commit source code, tests, README and `package-lock.json`. `.gitignore` excludes `node_modules/`, `data/` and `.env` files.

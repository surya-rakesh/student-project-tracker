// Vercel serverless entry: every /api/* request is routed here (see vercel.json).
import { createApp } from '../app.js';
import { db } from '../database.js';

export default createApp(db);

import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });

const repoRoot = process.cwd().endsWith('backend') ? path.resolve(process.cwd(), '..') : process.cwd();
const dbPathFromEnv = process.env.DB_PATH ?? './backend/data/sigva.sqlite';
const jwtSecret = process.env.JWT_SECRET;

export const config = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: jwtSecret ?? '',
  sessionTimeoutMinutes: Number(process.env.SESSION_TIMEOUT_MINUTES ?? 30),
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  dbPath: path.resolve(repoRoot, dbPathFromEnv)
};

if (!Number.isFinite(config.sessionTimeoutMinutes) || config.sessionTimeoutMinutes <= 0) {
  throw new Error('SESSION_TIMEOUT_MINUTES debe ser un número mayor que cero.');
}

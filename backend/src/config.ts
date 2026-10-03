import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });

const repoRoot = process.cwd().endsWith('backend') ? path.resolve(process.cwd(), '..') : process.cwd();
const dbPathFromEnv = process.env.DB_PATH ?? './backend/data/sigva.sqlite';

export const config = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: process.env.JWT_SECRET ?? 'development-secret',
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  dbPath: path.resolve(repoRoot, dbPathFromEnv)
};

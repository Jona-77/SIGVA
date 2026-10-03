import { app, startServer, syncDatabase } from './app.js';
import { config } from './config.js';

async function main() {
  await syncDatabase();
  app.listen(config.port, () => {
    console.log(`SIGVA backend listening on http://localhost:${config.port}`);
  });
}

main().catch((error) => {
  console.error('Error starting server', error);
  process.exit(1);
});

export { app, startServer };

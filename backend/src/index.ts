import { startServer } from './app.js';

async function main() {
  await startServer();
}

main().catch((error) => {
  console.error('Error starting server', error);
  process.exit(1);
});

export { startServer };

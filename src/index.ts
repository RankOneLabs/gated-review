import { runHttpServer } from '#root/src/server.js';

await runHttpServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

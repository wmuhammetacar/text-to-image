import { runWorkerLoop } from "./worker";

runWorkerLoop().catch((error) => {
  console.error(
    JSON.stringify({
      level: "ERROR",
      event: "worker_fatal",
      message: error instanceof Error ? error.message : "UNKNOWN",
    }),
  );
  process.exitCode = 1;
});

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.RUN_WORKER_IN_PROCESS === "false") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Hosted (Netlify) mode: no database, no in-process worker.
  if (process.env.NEXUS_HOSTED === "true" || (process.env.NEXUS_HOSTED !== "false" && process.env.NETLIFY)) return;
  const { ensureWorker } = await import("@/lib/services/bootstrap");
  ensureWorker();
}

import { eq } from "drizzle-orm";
import { findDemoDoc, docVersion } from "@/lib/adapters/demo/corpus";
import { getDb, schema } from "@/lib/db/client";

/**
 * Renders the fictional DEMO snapshot of a source instead of linking to the
 * real site. Only URLs in the demo corpus are served.
 */
export default async function DemoSourcePage({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const { url } = await searchParams;
  const doc = url ? findDemoDoc(url) : undefined;
  if (!doc) return <div className="p-6 text-muted">Not a demo source.</div>;
  // Show the version matching the most advanced monitoring scan of any demo person.
  const db = await getDb();
  const jobs = await db.select({ n: schema.monitoringJobs.runCount }).from(schema.monitoringJobs).innerJoin(schema.persons, eq(schema.persons.id, schema.monitoringJobs.personId)).where(eq(schema.persons.isDemo, true));
  const epoch = Math.max(0, ...jobs.map((j) => j.n));
  const text = docVersion(doc, epoch);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 rounded-[4px] border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
        <b className="mono tracking-[0.14em]">DEMO DATA</b> — fictional page rendered locally. This is not a real website and no real person is described.
      </div>
      <div className="panel p-5">
        <div className="label">{doc.sourcePlatform} · simulated source</div>
        <div className="mono mt-1 break-all text-[11px] text-muted">{doc.url}</div>
        <h1 className="mt-3 text-[20px] font-semibold">{doc.title}</h1>
        {text === null ? <p className="mt-4 text-alert">404 — this page is no longer available.</p> : <p className="mt-4 leading-relaxed text-text-2">{text}</p>}
      </div>
    </div>
  );
}

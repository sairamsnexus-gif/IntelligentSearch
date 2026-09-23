import { z } from "zod";
import { api, body } from "@/lib/api/handler";
import { adapterByName, adapterStatuses, setAdapterEnabled } from "@/lib/adapters/registry";
import { DomainError } from "@/lib/errors";
import { audit } from "@/lib/services/timeline";

export const GET = api(async ({ req }) => ({ providers: await adapterStatuses(req.nextUrl.searchParams.get("refresh") === "1") }), { access: "admin" });

const schema = z.object({ name: z.string().max(40), enabled: z.boolean() });

export const PATCH = api(
  async ({ req, user }) => {
    const b = await body(req, schema);
    if (!adapterByName(b.name)) throw new DomainError("Unknown provider", 404);
    await setAdapterEnabled(b.name, b.enabled);
    await audit(user!.uid, "provider.toggle", b.name, { enabled: b.enabled });
    return { ok: true };
  },
  { access: "admin" },
);

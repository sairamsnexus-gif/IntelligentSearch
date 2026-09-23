import { NextResponse } from "next/server";
import { z } from "zod";
import { api, body } from "@/lib/api/handler";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { createFirstAdmin, userCount } from "@/lib/services/users";

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(10, "Use at least 10 characters").max(200) });

export const GET = api(async () => ({ needsSetup: (await userCount()) === 0 }), { access: "public" });

export const POST = api(
  async ({ req }) => {
    const { email, password } = await body(req, schema);
    const u = await createFirstAdmin(email, password);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, signSession({ uid: u.id, role: "admin", email: u.email }), cookieOptions);
    return res;
  },
  { access: "public", rpm: 5 },
);

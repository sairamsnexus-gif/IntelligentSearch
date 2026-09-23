import { NextResponse } from "next/server";
import { api } from "@/lib/api/handler";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const POST = api(
  async () => {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  },
  { access: "public" },
);

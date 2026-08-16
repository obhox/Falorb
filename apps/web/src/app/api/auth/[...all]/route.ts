import { auth } from "@/server/auth";

/** better-auth owns sign-up, sign-in, sign-out, session and password flows. */
export const GET = (request: Request) => auth.handler(request);
export const POST = (request: Request) => auth.handler(request);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

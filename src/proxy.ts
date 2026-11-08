import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "leash_ws";
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * 1. Reject cross-site state-changing API calls (defence in depth on top of SameSite=Lax).
 * 2. Give every visitor an isolated, anonymous workspace (no sign-up for judges).
 */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host; // "null" origins (sandboxed frames, file://) fail here -> rejected
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  if (UNSAFE.has(request.method) && request.nextUrl.pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin");
    if (origin && originHost(origin) !== request.headers.get("host")) {
      return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
    }
  }

  if (request.cookies.get(COOKIE)) return NextResponse.next();
  const id = crypto.randomUUID();
  // Make the cookie visible to route handlers in this same request.
  request.cookies.set(COOKIE, id);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 60,
  });
  return response;
}

export const config = {
  // Webhooks come from PayPal, not a browser session.
  matcher: ["/((?!api/paypal/webhook|api/health|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};

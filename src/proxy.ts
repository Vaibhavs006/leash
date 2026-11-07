import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "leash_ws";

/** Give every visitor an isolated, anonymous workspace (no sign-up for judges). */
export function proxy(request: NextRequest) {
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
  matcher: ["/((?!api/paypal/webhook|api/health|_next/static|_next/image|favicon.ico).*)"],
};

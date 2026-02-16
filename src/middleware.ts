import { NextResponse, type NextRequest } from "next/server";

// x402 payment middleware is conditionally loaded when X402_PAY_TO_ADDRESS is set.
// It gates premium API routes with on-chain USDC payments.
let x402Handler: ((req: NextRequest) => Promise<NextResponse | undefined>) | null = null;

async function initX402() {
  const payTo = process.env.X402_PAY_TO_ADDRESS;
  if (!payTo) return null;

  try {
    const { paymentProxy } = await import("@x402/next");
    const { x402ResourceServer, HTTPFacilitatorClient } = await import("@x402/core/server");
    const { registerExactEvmScheme } = await import("@x402/evm/exact/server");

    const facilitatorUrl = process.env.X402_FACILITATOR_URL || "https://api.cdp.coinbase.com/platform/v2/x402";
    const network = (process.env.X402_NETWORK || "eip155:8453") as `${string}:${string}`;
    const premiumPrice = process.env.PREMIUM_PRICE_USDC || "9.99";

    const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
    const server = new x402ResourceServer(facilitatorClient);
    registerExactEvmScheme(server);

    const routes = {
      "/api/v1/premium/activate": {
        accepts: [
          {
            scheme: "exact" as const,
            price: `$${premiumPrice}`,
            network,
            payTo,
          },
        ],
        description: "Activate 30-day TindAi premium subscription",
        mimeType: "application/json",
      },
    };

    return paymentProxy(routes, server);
  } catch (error) {
    console.error("Failed to initialize x402:", error);
    return null;
  }
}

// Initialize once at module load
const x402Promise = initX402();

function addSecurityHeaders(response: NextResponse) {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );

  // CORS for API routes
  const origin = process.env.CORS_ALLOWED_ORIGIN || "https://tindai.tech";
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    addSecurityHeaders(response);
    return response;
  }

  // x402 payment gate for premium routes
  if (pathname.startsWith("/api/v1/premium")) {
    if (!x402Handler) {
      x402Handler = (await x402Promise) || null;
    }
    if (x402Handler) {
      try {
        const result = await x402Handler(request);
        if (result) {
          addSecurityHeaders(result);
          return result;
        }
      } catch (error) {
        console.error("x402 middleware error:", error);
        // Fall through to normal handling if x402 fails
      }
    }
  }

  // All routes: security headers
  const response = NextResponse.next();
  addSecurityHeaders(response);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

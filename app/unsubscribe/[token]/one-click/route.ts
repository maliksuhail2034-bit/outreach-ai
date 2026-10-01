import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processUnsubscribe } from "@/lib/email/unsubscribe";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";

// Same runtime requirement as every other Route Handler in this codebase
// that touches Supabase server-side (see app/api/health/route.ts).
export const runtime = "nodejs";

const NO_STORE = "no-store, no-cache, must-revalidate, proxy-revalidate";

function plainText(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_STORE },
  });
}

// RFC 8058 one-click unsubscribe — the URL in every campaign email's
// List-Unsubscribe header (see lib/email/providers/smtp.ts). A mailbox
// provider POSTs "List-Unsubscribe=One-Click" here with no session and no
// cookies; the token in the URL is the only identity, exactly as for the
// confirmation page's Server Action, and the unsubscribe itself is the same
// processUnsubscribe call. Nothing in the request body is trusted beyond the
// one-click marker: who is unsubscribed comes only from the verified token.
//
// Requiring the marker keeps a stray or prefetching POST from unsubscribing
// anyone. Repeated POSTs are harmless: processUnsubscribe is idempotent.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return plainText("This unsubscribe link is invalid.", 400);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return plainText("Expected a one-click unsubscribe request.", 400);
  }
  if (formData.get("List-Unsubscribe") !== "One-Click") {
    return plainText("Expected a one-click unsubscribe request.", 400);
  }

  const result = await processUnsubscribe(createAdminClient(), verified);
  if (!result.ok) return plainText(result.error, 400);
  // The address isn't echoed back: the caller is a mail provider, not the
  // recipient, and has no need for it.
  return plainText("You have been unsubscribed.", 200);
}

// A client that opens the List-Unsubscribe URL instead of POSTing to it gets
// the regular confirmation page, which never unsubscribes on load (link
// scanners and prefetchers fetch with GET — see UnsubscribeConfirm).
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, request.url), {
    status: 303,
    headers: { "Cache-Control": NO_STORE },
  });
}

import { VerificationError, type VerificationProvider, type VerificationResult } from "../provider";

// Plain fetch against the real-time verification endpoint — no vendor SDK,
// matching this repo's low-dependency posture (see
// lib/ai/providers/anthropic.ts for the same reasoning). Confirmed against
// the live API directly (not just docs, which are inconsistent about the
// resultcode <-> result mapping — see the comment on classifyResult below):
//
//   GET https://api.millionverifier.com/api/v3/?api={key}&email={email}&timeout={n}
//   -> { email, quality, result, resultcode, subresult, free, role,
//        didyoumean, credits, executiontime, error, livemode }
//
// On success `error` is "" and `result` is one of
// ok/catch_all/unknown/disposable/invalid. On an account-level failure
// (bad key, no credits, blocked IP) `result` is "" and `error` holds a
// human-readable message — this API always responds 200, so unlike
// lib/ai/providers/anthropic.ts there's no status code to branch on; the
// `error` field is the only signal.
const MILLIONVERIFIER_API_URL = "https://api.millionverifier.com/api/v3/";
const CONNECTION_TIMEOUT_SECONDS = 20;
const REQUEST_TIMEOUT_MS = 25_000;

interface MillionVerifierResponseBody {
  email?: string;
  quality?: string;
  result?: string;
  resultcode?: number;
  subresult?: string;
  free?: boolean;
  role?: boolean;
  didyoumean?: string;
  credits?: number;
  executiontime?: number;
  error?: string;
  livemode?: boolean;
}

// MillionVerifier's own published resultcode table (1=ok, 2=catch_all,
// 3=unknown, 4=error, 5=disposable, 6=invalid) does not match what the API
// actually returns for its own documented test keys — a genuine
// "internal_error" verification came back as resultcode 5 with
// result:"unknown", not resultcode 3. The `result` string is unambiguous
// and self-describing regardless of that drift, so this maps off `result`
// only; `resultcode` is passed through into `detail` for visibility but
// never branched on.
function classifyResult(result: string): VerificationResult["status"] {
  switch (result) {
    case "ok":
      return "valid";
    case "catch_all":
      return "catch_all";
    case "unknown":
      return "unknown";
    case "disposable":
    case "invalid":
      return "invalid";
    default:
      return "unknown";
  }
}

// MillionVerifier's API doesn't return a numeric score — this is our own
// deterministic derivation from the status it does return, not a
// provider-native value.
function deriveRiskScore(status: VerificationResult["status"]): number | null {
  switch (status) {
    case "valid":
      return 100;
    case "catch_all":
      return 50;
    case "unknown":
      return 40;
    case "invalid":
      return 0;
    default:
      return null;
  }
}

function classifyAccountError(message: string): "retry" | "invalid_key" | "failed" {
  const lower = message.toLowerCase();
  if (lower.includes("apikey") || lower.includes("api key") || lower.includes("credit")) {
    return "invalid_key";
  }
  if (lower.includes("rate limit") || lower.includes("timeout")) {
    return "retry";
  }
  return "failed";
}

export class MillionVerifierProvider implements VerificationProvider {
  constructor(private readonly apiKey: string) {}

  async verify(email: string): Promise<VerificationResult> {
    const url = new URL(MILLIONVERIFIER_API_URL);
    url.searchParams.set("api", this.apiKey);
    url.searchParams.set("email", email);
    url.searchParams.set("timeout", String(CONNECTION_TIMEOUT_SECONDS));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (error) {
      throw new VerificationError(
        `MillionVerifier request failed: ${error instanceof Error ? error.message : "unknown network error"}`,
        "retry",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new VerificationError(`MillionVerifier request failed (${response.status}).`, "retry");
    }

    const body = (await response.json().catch(() => null)) as MillionVerifierResponseBody | null;
    if (!body) {
      throw new VerificationError("MillionVerifier returned an unparseable response.", "retry");
    }

    if (body.error) {
      throw new VerificationError(body.error, classifyAccountError(body.error));
    }

    const status = classifyResult(body.result ?? "");

    return {
      status,
      riskScore: deriveRiskScore(status),
      detail: {
        quality: body.quality ?? null,
        result: body.result ?? null,
        resultcode: body.resultcode ?? null,
        subresult: body.subresult ?? null,
        free: body.free ?? null,
        role: body.role ?? null,
        didyoumean: body.didyoumean || null,
        disposable: body.result === "disposable",
        credits: body.credits ?? null,
        executiontime: body.executiontime ?? null,
      },
    };
  }
}

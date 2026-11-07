"use client";

import { useState, useTransition, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { KeyRoundIcon, SmartphoneIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { recordMfaEnrolledAction } from "@/app/console/2fa/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { totpQrDataUri } from "@/lib/staff/totp-qr";

const CODE_PATTERN = /^\d{6}$/;

function CodeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="mfa-code">6-digit code from your authenticator app</Label>
      <Input
        id="mfa-code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        className="font-mono tracking-[0.3em]"
      />
    </div>
  );
}

// Enrollment: creates a TOTP factor, shows its QR code, and verifies the
// first code — which also upgrades this session to aal2.
export function MfaSetupForm() {
  const router = useRouter();
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      // A previous, never-verified attempt would block a new enrollment.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const stale of factors?.all ?? []) {
        if (stale.factor_type === "totp" && stale.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: stale.id });
        }
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Polimatiq staff ${new Date().toISOString().slice(0, 10)}`,
      });
      if (enrollError || !data) {
        setError(enrollError?.message ?? "Couldn't start 2-step setup. Try again.");
        return;
      }
      setFactor({ id: data.id, qr: totpQrDataUri(data.totp.qr_code), secret: data.totp.secret });
    });
  }

  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factor || !CODE_PATTERN.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (verifyError) {
        setError("That code didn't match. Check your phone's clock and try the newest code.");
        return;
      }
      await recordMfaEnrolledAction();
      router.replace("/console");
      router.refresh();
    });
  }

  if (!factor) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Staff accounts must use 2-step login. Install an authenticator app (Google Authenticator, Microsoft
          Authenticator, 1Password, Authy…) on your phone, then continue.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button onClick={start} disabled={pending} className="w-full">
          <SmartphoneIcon aria-hidden="true" />
          {pending ? "Preparing…" : "Set up authenticator"}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <div className="flex justify-center rounded-lg border border-border bg-white p-4">
        <Image src={factor.qr} alt="QR code to add Polimatiq to your authenticator app" width={180} height={180} unoptimized />
      </div>
      <p className="text-xs text-muted-foreground">
        Can&apos;t scan? Enter this key in the app instead:{" "}
        <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-foreground">{factor.secret}</code>
      </p>
      <CodeField value={code} onChange={setCode} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Verifying…" : "Verify and continue"}
      </Button>
    </form>
  );
}

// Sign-in step two for a staff member who already enrolled.
export function MfaVerifyForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!CODE_PATTERN.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp.find((factor) => factor.status === "verified");
      if (listError || !totp) {
        setError("No authenticator is set up for this account. Ask the owner or security team to reset it.");
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
      if (verifyError) {
        setError("That code didn't match. Try the newest code from your app.");
        setCode("");
        return;
      }
      router.replace("/console");
      router.refresh();
    });
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <KeyRoundIcon className="size-4 shrink-0" aria-hidden="true" />
        Open your authenticator app and enter the current code for Polimatiq.
      </div>
      <CodeField value={code} onChange={setCode} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Verifying…" : "Verify"}
      </Button>
    </form>
  );
}

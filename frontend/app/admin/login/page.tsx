"use client";

import { useState } from "react";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAdminSession } from "@/lib/admin-session";

export default function AdminLoginPage() {
  const { signIn } = useAdminSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Нэвтэрч чадсангүй.");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-[360px] p-6">
        <div className="mb-1 text-[17px] font-medium">itgel админ</div>
        <p className="mt-0 mb-5 text-[13px] text-ink-2">
          Ажилтны и-мэйл, нууц үгээрээ нэвтэрнэ үү.
        </p>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="И-мэйл">
            <Input
              value={email}
              onChange={setEmail}
              type="email"
              inputMode="email"
              placeholder="admin@itgel.mn"
              autoFocus
            />
          </Field>
          <Field label="Нууц үг">
            <Input value={password} onChange={setPassword} type="password" placeholder="••••••" />
          </Field>

          {error && <ErrorNote>{error}</ErrorNote>}

          <Button full type="submit" loading={busy} disabled={!email || password.length < 6}>
            Нэвтрэх
          </Button>
        </form>
      </Card>
    </div>
  );
}

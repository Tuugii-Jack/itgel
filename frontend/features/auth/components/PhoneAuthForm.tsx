"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, ErrorNote, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatMnPhone, MN_PHONE_RE, parseMnPhone } from "@/lib/phone";
import { smsStatusLabel } from "@/lib/smsStatus";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import type { WorkspaceUser } from "@/lib/admin-session";

type WorkspaceGrant = { token: string; user: WorkspaceUser };

type Step = "phone" | "code" | "name";

/**
 * Утас → код → (нэргүй бол нэр) → үргэлжлүүлэх.
 * Анх удаа / бүртгэлтэй гэж салгахгүй.
 */
export function PhoneAuthForm({
  onDone,
}: {
  onDone?: (workspace?: WorkspaceGrant | null) => void;
  /** Хуучин props — ижил урсгал. */
  variant?: "default" | "checkout";
  initialMode?: "login" | "register";
}) {
  const { signIn } = useSession();
  const toast = useToast();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [pendingWorkspace, setPendingWorkspace] = useState<WorkspaceGrant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [smsStatus, setSmsStatus] = useState<string | null>(null);
  const lock = useRef(false);
  const autoTried = useRef<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === "phone") return;
    inputRef.current?.focus();
  }, [step]);

  const finish = useCallback(async (token: string, workspace?: WorkspaceGrant | null) => {
    await signIn(token, workspace ?? null);
    toast.success("Амжилттай нэвтэрлээ.");
    onDone?.(workspace ?? null);
  }, [onDone, signIn, toast]);

  const send = async () => {
    if (lock.current) return;
    if (!MN_PHONE_RE.test(phone)) {
      setError("8 оронтой утасны дугаар оруулна уу.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.sendOtp(phone);
      setCooldown(result.resendAfterSec);
      setSmsStatus(result.smsStatus ?? "queued");
      setCode("");
      autoTried.current = null;
      setStep("code");
    } catch (e) {
      setError(networkOrApiMessage(e, "Код илгээж чадсангүй."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const verify = useCallback(async () => {
    if (lock.current || code.length !== 6) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.verifyOtp(phone, code);
      const existingName = result.customer.name?.trim() ?? "";
      if (existingName) {
        await finish(result.token, result.workspace);
        return;
      }
      setPendingToken(result.token);
      setPendingWorkspace(result.workspace);
      setStep("name");
    } catch (e) {
      setError(verifyErrorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [code, finish, phone]);

  const verifyRef = useRef(verify);
  useEffect(() => {
    verifyRef.current = verify;
  }, [verify]);

  useEffect(() => {
    if (step !== "code" || code.length !== 6 || busy) return;
    if (autoTried.current === code) return;
    autoTried.current = code;
    void verifyRef.current();
  }, [code, step, busy]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (lock.current) return;
    if (!trimmed) {
      setError("Нэрээ оруулна уу.");
      return;
    }
    if (!pendingToken) {
      setError("Дахин код авна уу.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.updateMe({ name: trimmed }, pendingToken);
      await finish(pendingToken, pendingWorkspace);
    } catch (e) {
      setError(networkOrApiMessage(e, "Нэр хадгалж чадсангүй."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const editPhone = () => {
    setStep("phone");
    setError(null);
    setCode("");
    autoTried.current = null;
  };

  const submit = () => {
    if (step === "phone") return send();
    if (step === "code") return verify();
    return saveName();
  };

  const phoneLabel = formatMnPhone(phone) || phone;
  const describedBy = error ? errorId : undefined;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      {step === "phone" && (
        <>
          <header className="flex flex-col gap-1">
            <label htmlFor="auth-phone" className="m-0 text-[15px] font-medium">
              Утасны дугаар
            </label>
            <p className="m-0 text-[13px] text-ink-2">
              Дугаараа баталгаажуулаад үргэлжлүүлээрэй.
            </p>
          </header>
          <Input
            id="auth-phone"
            name="tel"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            enterKeyHint="send"
            spellCheck={false}
            autoCapitalize="off"
            inputRef={inputRef}
            value={phone}
            onChange={(v) => {
              setPhone(parseMnPhone(v));
              if (error) setError(null);
            }}
            placeholder="9911 2233"
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
          />
          {error && <ErrorNote id={errorId}>{error}</ErrorNote>}
          <Button full type="submit" loading={busy} disabled={!MN_PHONE_RE.test(phone)}>
            {busy ? "Код илгээж байна" : "Код авах"}
          </Button>
        </>
      )}

      {step === "code" && (
        <>
          <header className="flex flex-col gap-1">
            <label htmlFor="auth-code" className="m-0 text-[15px] font-medium">
              Баталгаажуулах код
            </label>
            <p className="m-0 text-[13px] text-ink-2">
              {phoneLabel} дугаарт илгээсэн 6 оронтой кодыг оруулна уу.
              {smsStatus ? ` ${smsStatusLabel(smsStatus)}.` : ""}
            </p>
          </header>
          <Input
            id="auth-code"
            name="one-time-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="done"
            spellCheck={false}
            autoCapitalize="off"
            maxLength={6}
            inputRef={inputRef}
            value={code}
            onChange={(v) => {
              setCode(v.replace(/\D/g, "").slice(0, 6));
              if (error) setError(null);
            }}
            placeholder="000000"
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
          />
          {error && <ErrorNote id={errorId}>{error}</ErrorNote>}
          <Button full type="submit" loading={busy} disabled={code.length !== 6}>
            {busy ? "Шалгаж байна" : "Үргэлжлүүлэх"}
          </Button>
          <div className="flex flex-col">
            <button
              type="button"
              disabled={cooldown > 0 || busy}
              onClick={() => void send()}
              className="min-h-11 cursor-pointer border-0 bg-transparent px-0 text-left text-[13px] text-ink-2 underline disabled:cursor-default disabled:no-underline disabled:opacity-60"
            >
              {cooldown > 0 ? `Код дахин авах · ${cooldown} сек` : "Код дахин авах"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={editPhone}
              className="min-h-11 cursor-pointer border-0 bg-transparent px-0 text-left text-[13px] text-ink-2 underline disabled:opacity-60"
            >
              Дугаар засах
            </button>
          </div>
        </>
      )}

      {step === "name" && (
        <>
          <header className="flex flex-col gap-1">
            <label htmlFor="auth-name" className="m-0 text-[15px] font-medium">
              Таны нэр
            </label>
            <p className="m-0 text-[13px] text-ink-2">
              Захиалгыг хэний нэрээр бүртгэх вэ?
            </p>
          </header>
          <Input
            id="auth-name"
            name="name"
            type="text"
            autoComplete="name"
            enterKeyHint="done"
            autoCapitalize="words"
            inputRef={inputRef}
            value={name}
            onChange={(v) => {
              setName(v);
              if (error) setError(null);
            }}
            placeholder="Овог, нэр"
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
          />
          {error && <ErrorNote id={errorId}>{error}</ErrorNote>}
          <Button full type="submit" loading={busy} disabled={!name.trim()}>
            {busy ? "Хадгалж байна" : "Үргэлжлүүлэх"}
          </Button>
        </>
      )}
    </form>
  );
}

function verifyErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.code === "NETWORK") return e.message;
  if (e instanceof ApiError) {
    if (e.status === 401) return "Код буруу байна.";
    if (e.status === 429) return e.message;
    if (e.message.includes("хугацаа")) {
      return "Кодны хугацаа дууссан байна. Шинэ код авна уу.";
    }
    if (e.message.includes("олдсонгүй")) return "Код олдсонгүй. Дахин илгээнэ үү.";
    return e.message;
  }
  return "Код шалгаж чадсангүй.";
}

function networkOrApiMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message;
  return fallback;
}

/** Хуучин нэр — импорт эвдэлгүй солих. */
export { PhoneAuthForm as EmailAuthForm };

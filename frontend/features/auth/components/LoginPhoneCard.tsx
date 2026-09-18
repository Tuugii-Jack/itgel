"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, ErrorNote, Input } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { formatMnPhone, MN_PHONE_RE, parseMnPhone } from "@/lib/phone";
import { smsStatusLabel } from "@/lib/smsStatus";
import { useToast } from "@/lib/toast";

export function LoginPhoneCard({
  adminId,
  title = "Нэвтрэх утас",
}: {
  adminId?: string;
  title?: string;
}) {
  const toast = useToast();
  const errorId = useId();
  const lock = useRef(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [smsStatus, setSmsStatus] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

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
      const result = await adminApi.issueLoginPhoneOtp(phone, adminId);
      setCooldown(result.resendAfterSec);
      setSmsStatus(result.smsStatus ?? "queued");
      setCode("");
      setStep("code");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Код илгээж чадсангүй.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const verify = async () => {
    if (lock.current || code.length !== 6) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await adminApi.verifyLoginPhone(phone, code, adminId);
      toast.success("Нэвтрэх дугаар холбогдлоо.");
      setStep("phone");
      setCode("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Код шалгаж чадсангүй.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[15px] font-medium">{title}</div>
      <p className="m-0 text-[13px] text-ink-2">
        Энэ дугаараар Profile-оос OTP-оор нэвтэрнэ. Хэрэглэгчийн утас солих нь энэ эрхийг шилжүүлэхгүй.
      </p>
      {step === "phone" ? (
        <>
          <Input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={(v) => {
              setPhone(parseMnPhone(v));
              if (error) setError(null);
            }}
            placeholder="9911 2233"
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
          />
          {error && <ErrorNote id={errorId}>{error}</ErrorNote>}
          <div>
            <Button
              size="sm"
              loading={busy}
              disabled={!MN_PHONE_RE.test(phone)}
              onClick={() => void send()}
            >
              {busy ? "Код илгээж байна" : "Код авах"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-[13px] text-ink-2">
            {formatMnPhone(phone) || phone} дугаарт илгээсэн кодыг оруулна уу.
            {smsStatus ? ` ${smsStatusLabel(smsStatus)}.` : ""}
          </p>
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(v) => {
              setCode(v.replace(/\D/g, "").slice(0, 6));
              if (error) setError(null);
            }}
            placeholder="000000"
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
          />
          {error && <ErrorNote id={errorId}>{error}</ErrorNote>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} disabled={code.length !== 6} onClick={() => void verify()}>
              {busy ? "Шалгаж байна" : "Баталгаажуулах"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setStep("phone");
                setError(null);
                setCode("");
              }}
            >
              Дугаар засах
            </Button>
          </div>
          <button
            type="button"
            disabled={cooldown > 0 || busy}
            onClick={() => void send()}
            className="min-h-11 cursor-pointer border-0 bg-transparent px-0 text-left text-[13px] text-ink-2 underline disabled:cursor-default disabled:no-underline disabled:opacity-60"
          >
            {cooldown > 0 ? `Код дахин авах · ${cooldown} сек` : "Код дахин авах"}
          </button>
        </>
      )}
    </div>
  );
}

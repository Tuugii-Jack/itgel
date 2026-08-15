"use client";

import { useEffect, useState } from "react";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";

type Mode = "login" | "register" | "forgot" | "reset";

/**
 * И-мэйл + нууц үг нэвтрэлт.
 * Бүртгэл шууд нэвтэрнэ. Код зөвхөн нууц үг сэргээхэд и-мэйлээр очно.
 * `variant="checkout"` — сагс: анх удаа vs бүртгэлтэй сонголт тод.
 */
export function EmailAuthForm({
  onDone,
  variant = "default",
  initialMode = "login",
}: {
  onDone?: () => void;
  variant?: "default" | "checkout";
  initialMode?: "login" | "register";
}) {
  const session = useSession();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  /** Нэвтрэх: и-мэйл эсвэл утас. */
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const go = (next: Mode) => {
    setMode(next);
    setError(null);
    setCode("");
  };

  const finish = async (token: string, okMessage: string) => {
    await session.signIn(token);
    toast.success(okMessage);
    onDone?.();
  };

  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.register({
        email: email.trim(),
        password,
        name: name.trim() || undefined,
        phone: phone.trim(),
      });
      await finish(result.token, "Бүртгэл амжилттай.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Бүртгэж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(loginId.trim(), password);
      await finish(result.token, "Амжилттай нэвтэрлээ.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Нэвтэрч чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.forgotPassword(email.trim());
      setCooldown(result.resendAfterSec);
      setPassword("");
      setCode("");
      setMode("reset");
      toast.success("Сэргээх код и-мэйл рүү илгээлээ.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Илгээж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.resetPassword(email.trim(), code, password);
      await finish(result.token, "Нууц үг шинэчлэгдлээ.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Сэргээж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "register"
      ? "Анх удаа захиалж байна"
      : mode === "login"
        ? "Бүртгэлээрээ нэвтрэх"
        : mode === "forgot"
          ? "Нууц үг мартсан"
          : "Шинэ нууц үг тохируулах";

  const hint =
    mode === "register"
      ? "И-мэйл, утас, нууц үгээрээ бүртгүүлнэ. Дараа нь утас эсвэл и-мэйлээр нэвтэрнэ."
      : mode === "login"
        ? "И-мэйл эсвэл утасны дугаар + нууц үгээрээ нэвтэрнэ."
        : mode === "forgot"
          ? "Бүртгэлтэй и-мэйл рүү сэргээх код илгээнэ."
          : "И-мэйл дээрх 6 оронтой кодыг оруулаад шинэ нууц үгээ тохируулна.";

  const showChooser = variant === "checkout" && (mode === "login" || mode === "register");
  const canLogin = Boolean(loginId.trim()) && password.length >= 6;
  const canRegister = Boolean(email.trim()) && password.length >= 6 && phone.length === 8;

  return (
    <div className="flex flex-col gap-3">
      {showChooser && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => go("register")}
            className={`cursor-pointer rounded-[10px] border px-3 py-3 text-left transition-colors ${
              mode === "register"
                ? "border-ink bg-ink text-white"
                : "border-line bg-bg text-ink hover:bg-surface"
            }`}
          >
            <div className="text-[14px] font-medium">Анх удаа</div>
            <div
              className={`mt-0.5 text-[12px] leading-[1.4] ${
                mode === "register" ? "text-white/75" : "text-muted"
              }`}
            >
              Бүртгүүлж захиалах
            </div>
          </button>
          <button
            type="button"
            onClick={() => go("login")}
            className={`cursor-pointer rounded-[10px] border px-3 py-3 text-left transition-colors ${
              mode === "login"
                ? "border-ink bg-ink text-white"
                : "border-line bg-bg text-ink hover:bg-surface"
            }`}
          >
            <div className="text-[14px] font-medium">Бүртгэлтэй</div>
            <div
              className={`mt-0.5 text-[12px] leading-[1.4] ${
                mode === "login" ? "text-white/75" : "text-muted"
              }`}
            >
              И-мэйл / утасаар
            </div>
          </button>
        </div>
      )}

      {!showChooser && variant !== "checkout" && (
        <div className="flex flex-wrap gap-3 text-[13px]">
          {(
            [
              ["login", "Нэвтрэх"],
              ["register", "Бүртгүүлэх"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              className={`cursor-pointer border-0 bg-transparent p-0 ${
                mode === id ? "font-medium text-ink underline" : "text-ink-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {(mode === "forgot" || mode === "reset") && (
        <div>
          <div className="text-[15px] font-medium">{title}</div>
          <p className="mt-1 mb-0 text-[13px] text-ink-2">{hint}</p>
        </div>
      )}

      {showChooser && (
        <p className="m-0 text-[13px] text-ink-2">{hint}</p>
      )}

      {(mode === "login" || mode === "forgot") && (
        <Field
          label={mode === "login" ? "И-мэйл эсвэл утас" : "И-мэйл"}
          hint={mode === "login" ? "Жишээ: you@gmail.com эсвэл 99112233" : undefined}
        >
          <Input
            value={mode === "login" ? loginId : email}
            onChange={(v) => {
              if (mode === "login") setLoginId(v);
              else setEmail(v);
            }}
            type={mode === "forgot" ? "email" : "text"}
            placeholder={mode === "login" ? "И-мэйл эсвэл 8 оронтой утас" : "you@gmail.com"}
            inputMode={mode === "login" ? "text" : "email"}
            autoFocus
          />
        </Field>
      )}

      {mode === "register" && (
        <>
          <Field label="И-мэйл">
            <Input
              value={email}
              onChange={setEmail}
              type="email"
              placeholder="you@gmail.com"
            />
          </Field>
          <Field label="Утасны дугаар" hint="Дараа нь утас + нууц үгээр нэвтэрнэ">
            <Input
              value={phone}
              onChange={(v) => setPhone(v.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              placeholder="99112233"
            />
          </Field>
          <Field label="Нэр" hint="Заавал биш">
            <Input value={name} onChange={setName} placeholder="Овог, нэр" />
          </Field>
        </>
      )}

      {(mode === "login" || mode === "register") && (
        <Field label="Нууц үг">
          <Input
            value={password}
            onChange={setPassword}
            type="password"
            placeholder="Дор хаяж 6 тэмдэгт"
          />
        </Field>
      )}

      {mode === "login" && (
        <button
          type="button"
          onClick={() => {
            if (loginId.includes("@")) setEmail(loginId.trim());
            go("forgot");
          }}
          className="cursor-pointer self-start border-0 bg-transparent p-0 text-[13px] text-ink-2 underline"
        >
          Нууц үгээ мартсан уу?
        </button>
      )}

      {mode === "reset" && (
        <>
          <Field label="И-мэйл">
            <Input value={email} onChange={setEmail} type="email" />
          </Field>
          <Field label="И-мэйл дээрх 6 оронтой код">
            <Input
              value={code}
              onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              placeholder="000000"
              maxLength={6}
              autoFocus
            />
          </Field>
          <Field label="Шинэ нууц үг">
            <Input
              value={password}
              onChange={setPassword}
              type="password"
              placeholder="Дор хаяж 6 тэмдэгт"
            />
          </Field>
          <button
            type="button"
            disabled={cooldown > 0 || busy}
            onClick={() => void forgot()}
            className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] text-ink-2 underline disabled:no-underline"
          >
            {cooldown > 0 ? `${cooldown} сек дараа дахин` : "Код дахин илгээх"}
          </button>
        </>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      {mode === "login" && (
        <Button full onClick={login} loading={busy} disabled={!canLogin}>
          Нэвтрэх
        </Button>
      )}
      {mode === "register" && (
        <Button full onClick={register} loading={busy} disabled={!canRegister}>
          Бүртгүүлэх
        </Button>
      )}
      {mode === "forgot" && (
        <>
          <Button full onClick={forgot} loading={busy} disabled={!email}>
            Сэргээх код илгээх
          </Button>
          <button
            type="button"
            onClick={() => go("login")}
            className="cursor-pointer self-center border-0 bg-transparent p-0 text-[13px] text-ink-2 underline"
          >
            Нэвтрэх рүү буцах
          </button>
        </>
      )}
      {mode === "reset" && (
        <>
          <Button
            full
            onClick={reset}
            loading={busy}
            disabled={code.length !== 6 || password.length < 6}
          >
            Нууц үг солиод нэвтрэх
          </Button>
          <button
            type="button"
            onClick={() => go("login")}
            className="cursor-pointer self-center border-0 bg-transparent p-0 text-[13px] text-ink-2 underline"
          >
            Нэвтрэх рүү буцах
          </button>
        </>
      )}
    </div>
  );
}

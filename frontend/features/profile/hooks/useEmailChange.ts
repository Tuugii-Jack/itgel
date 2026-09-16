import { useState, type Dispatch, type SetStateAction } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";

export function useEmailChange(setBusy: Dispatch<SetStateAction<boolean>>) {
  const session = useSession();
  const toast = useToast();
  const me = session.me!;
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailStep, setEmailStep] = useState<"form" | "code">("form");

  const requestEmailChange = async () => {
    setBusy(true);
    try {
      await api.changeEmail(
        newEmail.trim(),
        me.hasPassword ? emailPassword : undefined,
      );
      setEmailStep("code");
      toast.success("Баталгаажуулах код илгээлээ.");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "И-мэйл солиж чадсангүй.",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmEmailChange = async () => {
    setBusy(true);
    try {
      const result = await api.verifyEmail(newEmail.trim(), emailCode);
      await session.signIn(result.token);
      setEmailStep("form");
      setNewEmail("");
      setEmailPassword("");
      setEmailCode("");
      toast.success("И-мэйл солигдлоо.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Код буруу байна.");
    } finally {
      setBusy(false);
    }
  };

  return {
    newEmail,
    setNewEmail,
    emailPassword,
    setEmailPassword,
    emailCode,
    setEmailCode,
    emailStep,
    setEmailStep,
    requestEmailChange,
    confirmEmailChange,
    hasPassword: me.hasPassword,
    email: me.email,
  };
}

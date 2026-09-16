import { useState, type Dispatch, type SetStateAction } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";

export function usePhoneChange(setBusy: Dispatch<SetStateAction<boolean>>) {
  const session = useSession();
  const toast = useToast();
  const me = session.me!;
  const [newPhone, setNewPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneStep, setPhoneStep] = useState<"form" | "code">("form");
  const [smsStatus, setSmsStatus] = useState<string | null>(null);

  const requestPhoneChange = async () => {
    setBusy(true);
    try {
      const result = await api.changePhone(newPhone.trim());
      setPhoneStep("code");
      setSmsStatus(result.smsStatus ?? "queued");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Утас солиж чадсангүй.",
      );
    } finally {
      setBusy(false);
    }
  };

  const resendPhoneChange = async () => {
    setBusy(true);
    try {
      const result = await api.resendPhoneChange(newPhone.trim());
      setSmsStatus(result.smsStatus ?? "queued");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Код илгээж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const confirmPhoneChange = async () => {
    setBusy(true);
    try {
      const result = await api.verifyPhoneChange(newPhone.trim(), phoneCode);
      await session.signIn(result.token);
      setPhoneStep("form");
      setNewPhone("");
      setPhoneCode("");
      setSmsStatus(null);
      toast.success("Нэвтрэх утас солигдлоо.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Код буруу байна.");
    } finally {
      setBusy(false);
    }
  };

  return {
    newPhone,
    setNewPhone,
    phoneCode,
    setPhoneCode,
    phoneStep,
    setPhoneStep,
    smsStatus,
    requestPhoneChange,
    resendPhoneChange,
    confirmPhoneChange,
    phone: me.phone,
  };
}

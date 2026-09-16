import { useState, type Dispatch, type SetStateAction } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";

export function usePasswordChange(setBusy: Dispatch<SetStateAction<boolean>>) {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const changePassword = async () => {
    setBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Нууц үг солигдлоо.");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Нууц үг солиж чадсангүй.",
      );
    } finally {
      setBusy(false);
    }
  };

  return {
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    changePassword,
  };
}

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";

export function useBankAccountForm() {
  const session = useSession();
  const toast = useToast();
  const me = session.me!;
  const [bankName, setBankName] = useState(me.bank?.name ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(
    me.bank?.accountNumber ?? "",
  );
  const [bankAccountName, setBankAccountName] = useState(
    me.bank?.accountName ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const bank = me.bank;
  const [seenBank, setSeenBank] = useState(bank);
  if (bank !== seenBank) {
    setSeenBank(bank);
    setBankName(bank?.name ?? "");
    setBankAccountNumber(bank?.accountNumber ?? "");
    setBankAccountName(bank?.accountName ?? "");
  }

  const complete =
    bankName.trim().length > 0 &&
    bankAccountNumber.trim().length >= 6 &&
    bankAccountName.trim().length > 0;

  const saveBank = async () => {
    if (!complete) {
      toast.error("Банк, дансны дугаар, дансны нэрийг бөглөнө үү.");
      return;
    }
    setSaving(true);
    try {
      await api.updateMe({
        bankName: bankName.trim(),
        bankAccountNumber: bankAccountNumber.trim(),
        bankAccountName: bankAccountName.trim(),
        defaultPayoutBank: true,
      });
      await session.refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      toast.success("Данс хадгалагдлаа.");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Данс хадгалах боломжгүй байна.",
      );
    } finally {
      setSaving(false);
    }
  };

  return {
    bankName,
    setBankName,
    bankAccountNumber,
    setBankAccountNumber,
    bankAccountName,
    setBankAccountName,
    saving,
    saved,
    complete,
    saveBank,
  };
}

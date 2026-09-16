import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";

export function useProfileDetailsForm() {
  const session = useSession();
  const toast = useToast();
  const me = session.me!;
  const [name, setName] = useState(me.name ?? "");
  const [district, setDistrict] = useState(me.address.district ?? "");
  const [khoroo, setKhoroo] = useState(me.address.khoroo ?? "");
  const [addressText, setAddressText] = useState(me.address.addressText ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateMe({
        name: name.trim() || null,
        district: district.trim() || null,
        khoroo: khoroo.trim() || null,
        addressText: addressText.trim() || null,
      });
      await session.refresh();
      setSaved(true);
      toast.success("Мэдээлэл хадгалагдлаа.");
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return {
    name,
    setName,
    district,
    setDistrict,
    khoroo,
    setKhoroo,
    addressText,
    setAddressText,
    saving,
    saved,
    error,
    save,
  };
}

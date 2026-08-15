"use client";

import { useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";

export default function AdminAccountPage() {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (newPassword.length < 6) {
      setError("Шинэ нууц үг хамгийн багадаа 6 тэмдэгт.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Шинэ нууц үг таарахгүй байна.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      toast.success("Нууц үг солигдлоо.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Солиж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[480px]">
      <PageHead title="Миний бүртгэл" hint="Нууц үгээ эндээс солино." />
      <Card className="flex flex-col gap-3 p-4">
        <Field label="Одоогийн нууц үг">
          <Input
            value={currentPassword}
            onChange={setCurrentPassword}
            type="password"
            placeholder="••••••"
          />
        </Field>
        <Field label="Шинэ нууц үг">
          <Input
            value={newPassword}
            onChange={setNewPassword}
            type="password"
            placeholder="••••••"
          />
        </Field>
        <Field label="Шинэ нууц үг (давтах)">
          <Input value={confirm} onChange={setConfirm} type="password" placeholder="••••••" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div>
          <Button
            size="sm"
            loading={busy}
            disabled={!currentPassword || newPassword.length < 6 || !confirm}
            onClick={() => void save()}
          >
            Нууц үг солих
          </Button>
        </div>
      </Card>
    </div>
  );
}

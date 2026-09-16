"use client";

import { useState } from "react";
import { Button, Card, ErrorNote, Input } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { AdminBatchDetail } from "@/lib/types";

/** Огноог input[type=date]-д тохирох хэлбэрт. */
function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function EditBatchForm({
  batch,
  onSaved,
}: {
  batch: AdminBatchDetail;
  onSaved: (updated: Partial<AdminBatchDetail>) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(batch.name);
  const [deadline, setDeadline] = useState(toDateInput(batch.deadline));
  const [etaFrom, setEtaFrom] = useState(toDateInput(batch.etaFrom));
  const [etaTo, setEtaTo] = useState(toDateInput(batch.etaTo));
  const [weightKg, setWeightKg] = useState(batch.weightKg?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await adminApi.updateBatch(batch.id, {
        name: name.trim(),
        deadline: deadline || null,
        etaFrom: etaFrom || null,
        etaTo: etaTo || null,
        weightKg: weightKg ? Number(weightKg) : null,
      });
      onSaved(updated);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="mb-1.5 text-[13px] text-ink-2">Нэр</div>
          <Input value={name} onChange={setName} />
        </div>
        <div>
          <div className="mb-1.5 text-[13px] text-ink-2">Захиалга хаагдах</div>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="h-11 w-full rounded-[8px] border border-line bg-bg px-3 text-[14px]"
          />
        </div>
        <div>
          <div className="mb-1.5 text-[13px] text-ink-2">Ирэх (эхлэх)</div>
          <input
            type="date"
            value={etaFrom}
            onChange={(e) => setEtaFrom(e.target.value)}
            className="h-11 w-full rounded-[8px] border border-line bg-bg px-3 text-[14px]"
          />
        </div>
        <div>
          <div className="mb-1.5 text-[13px] text-ink-2">Ирэх (дуусах)</div>
          <input
            type="date"
            value={etaTo}
            onChange={(e) => setEtaTo(e.target.value)}
            className="h-11 w-full rounded-[8px] border border-line bg-bg px-3 text-[14px]"
          />
        </div>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <div>
          <div className="mb-1.5 text-[13px] text-ink-2">Жин (кг)</div>
          <Input value={weightKg} onChange={setWeightKg} placeholder="0" className="w-28" />
        </div>
        <Button onClick={save} loading={busy} disabled={!name.trim()}>
          Хадгалах
        </Button>
      </div>
      <p className="mt-2 mb-0 text-[12px] text-muted">
        Хаагдах огноог өөрчлөхөд багцын бүх урьдчилсан бараа болон захиалсан
        хүмүүсийн ирэх огноо дагаж шинэчлэгдэнэ.
      </p>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Card>
  );
}

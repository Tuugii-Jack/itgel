"use client";

import { useState } from "react";
import { Button, Card, ErrorNote, Input } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { AdminBatch } from "@/lib/types";

export function CreateBatchForm({ onCreated }: { onCreated: (batch: AdminBatch) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [cargoRef, setCargoRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const batch = await adminApi.createBatch({
        name: name.trim(),
        cargoRef: cargoRef.trim() || undefined,
      });
      onCreated({
        ...batch,
        orderCount: 0,
        totalValue: 0,
        nextStage: "AT_WAREHOUSE",
        previousStage: null,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Багц үүсгэж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <div className="mb-1.5 text-[13px] text-ink-2">Багцын нэр</div>
          <Input value={name} onChange={setName} placeholder="Жишээ: 8-р сарын ачаа" />
        </div>
        <div className="flex-1">
          <div className="mb-1.5 text-[13px] text-ink-2">Карго / тээврийн лавлагаа</div>
          <Input value={cargoRef} onChange={setCargoRef} placeholder="Заавал биш" />
        </div>
        <Button onClick={create} loading={busy} disabled={!name.trim()}>
          Үүсгэх
        </Button>
      </div>
      <p className="mt-2 mb-0 text-[12px] text-muted">
        Багц «Зам дээр» шатаас эхэлнэ. Дараа нь хаагдсан гаргалтыг он/сараар сонгож нэмнэ.
      </p>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Card>
  );
}

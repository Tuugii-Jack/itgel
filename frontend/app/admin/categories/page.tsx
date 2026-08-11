"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { AdminCategory } from "@/lib/types";

export default function CategoriesPage() {
  const toast = useToast();
  const [rows, setRows] = useState<AdminCategory[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [loading, setLoading] = useState(true);
  /** Аль мөрөнд аль үйлдэл явж байгааг заана (жишээ: "id:toggle"). */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = busyKey !== null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminApi.categories());
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ачаалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusyKey("create");
    setError(null);
    try {
      await adminApi.createCategory({ name: name.trim(), sortOrder: rows.length });
      setName("");
      toast.success("Ангилал үүслээ.");
      await load();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Үүсгэж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const rename = async (id: string) => {
    setBusyKey(`${id}:rename`);
    setError(null);
    try {
      await adminApi.updateCategory(id, { name: editName.trim() });
      setEditing(null);
      toast.success("Нэр хадгалагдлаа.");
      await load();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const toggleActive = async (row: AdminCategory) => {
    setBusyKey(`${row.id}:toggle`);
    setError(null);
    try {
      await adminApi.updateCategory(row.id, { isActive: !row.isActive });
      toast.success(row.isActive ? "Ангилал идэвхгүй боллоо." : "Ангилал идэвхжлээ.");
      await load();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (row: AdminCategory) => {
    setBusyKey(`${row.id}:delete`);
    setError(null);
    try {
      await adminApi.deleteCategory(row.id);
      toast.success("Ангилал устлаа.");
      await load();
    } catch (e) {
      // Бараатай ангилал устгагдахгүй — 409.
      const message = e instanceof ApiError ? e.message : "Устгаж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="max-w-[760px]">
      <PageHead
        title="Ангилал"
        hint="Идэвхгүй ангилал хэрэглэгчийн шүүлтүүрт харагдахгүй, харин байгаа бараа хэвээр зарагдана."
      />

      <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <div className="mb-1.5 text-[13px] text-ink-2">Шинэ ангилал</div>
          <Input value={name} onChange={setName} placeholder="Ангилалын нэр" />
        </div>
        <Button onClick={create} loading={busyKey === "create"} disabled={busy || !name.trim()}>
          Нэмэх
        </Button>
      </Card>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-muted" />
        </div>
      ) : rows.length === 0 ? (
        <Empty>Ангилал алга байна.</Empty>
      ) : (
        <Card className="divide-y divide-line">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-3 p-4">
              {editing === row.id ? (
                <>
                  <div className="min-w-[180px] flex-1">
                    <Input value={editName} onChange={setEditName} />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => rename(row.id)}
                    loading={busyKey === `${row.id}:rename`}
                    disabled={busy}
                  >
                    Хадгалах
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Болих
                  </Button>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px]">{row.name}</div>
                    <div className="text-[13px] text-muted">{row.productCount} бараа</div>
                  </div>
                  <Badge tone={row.isActive ? "ok" : "neutral"}>
                    {row.isActive ? "Идэвхтэй" : "Идэвхгүй"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(row.id);
                      setEditName(row.name);
                    }}
                  >
                    Нэр солих
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleActive(row)}
                    disabled={busy}
                    loading={busyKey === `${row.id}:toggle`}
                  >
                    {row.isActive ? "Нуух" : "Идэвхжүүлэх"}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => remove(row)}
                    disabled={busy || row.productCount > 0}
                    loading={busyKey === `${row.id}:delete`}
                  >
                    Устгах
                  </Button>
                </>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import type { AdminCategory } from "@/lib/types";

export default function CategoriesPage() {
  const [rows, setRows] = useState<AdminCategory[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminApi.categories());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.createCategory({ name: name.trim(), sortOrder: rows.length });
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Үүсгэж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const rename = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateCategory(id, { name: editName.trim() });
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Хадгалж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row: AdminCategory) => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateCategory(row.id, { isActive: !row.isActive });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Хадгалж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: AdminCategory) => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.deleteCategory(row.id);
      await load();
    } catch (e) {
      // Бараатай ангилал устгагдахгүй — 409.
      setError(e instanceof ApiError ? e.message : "Устгаж чадсангүй.");
    } finally {
      setBusy(false);
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
        <Button onClick={create} loading={busy} disabled={!name.trim()}>
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
                  <Button size="sm" onClick={() => rename(row.id)} loading={busy}>
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
                  <Button size="sm" variant="outline" onClick={() => toggleActive(row)} disabled={busy}>
                    {row.isActive ? "Нуух" : "Идэвхжүүлэх"}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => remove(row)}
                    disabled={busy || row.productCount > 0}
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

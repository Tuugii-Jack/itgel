"use client";

import { Select } from "@/components/admin/shared";
import { Card, Field, Input, Textarea } from "@/components/ui";
import type { AdminCategory } from "@/lib/types";

export function ProductBasicsCard({
  name,
  onName,
  description,
  onDescription,
  categoryId,
  onCategory,
  categories,
  descriptionRows = 5,
}: {
  name: string;
  onName: (value: string) => void;
  description: string;
  onDescription: (value: string) => void;
  categoryId: string;
  onCategory: (value: string) => void;
  categories: AdminCategory[];
  descriptionRows?: number;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <Field label="Нэр">
        <Input value={name} onChange={onName} placeholder="Барааны нэр" />
      </Field>
      <Field label="Тайлбар">
        {descriptionRows >= 5 ? (
          <Textarea
            value={description}
            onChange={onDescription}
            rows={descriptionRows}
            resize="y"
            className="min-h-[140px] max-h-[70vh]"
          />
        ) : (
          <Textarea value={description} onChange={onDescription} rows={descriptionRows} />
        )}
      </Field>
      <Field label="Ангилал">
        <Select
          value={categoryId}
          onChange={onCategory}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          className="w-full"
        />
      </Field>
    </Card>
  );
}

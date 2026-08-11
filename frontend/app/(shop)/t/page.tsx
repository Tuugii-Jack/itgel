"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorNote, Input } from "@/components/ui";

export default function LookupPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const go = () => {
    const clean = code.trim().toUpperCase();
    if (!/^PH-[A-Z0-9]{6}$/.test(clean)) {
      setError("Захиалгын код PH- гэж эхэлж, 6 тэмдэгттэй байна.");
      return;
    }
    router.push(`/t/${clean}`);
  };

  return (
    <div className="screen">
      <div className="px-4 pt-6 lg:mx-auto lg:max-w-[480px] lg:px-0 lg:pt-10">
        <div className="mb-4 text-[20px] font-medium lg:text-[24px]">Захиалга хянах</div>
        <Card className="flex flex-col gap-3 p-4">
          <div>
            <div className="text-[15px] font-medium">Захиалгын кодоо оруулна уу</div>
            <p className="mt-1 mb-0 text-[13px] text-ink-2">
              Захиалга өгөхөд SMS-ээр ирсэн код. Нэвтрэх шаардлагагүй.
            </p>
          </div>
          <Input
            value={code}
            onChange={(v) => {
              setCode(v.toUpperCase());
              setError(null);
            }}
            placeholder="PH-XXXXXX"
            maxLength={9}
            autoFocus
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button full onClick={go}>
            Хайх
          </Button>
        </Card>

        <div className="pt-4 text-center">
          <Link href="/profile" className="text-[13px] text-ink-2">
            Бүх захиалгаа утасны дугаараар харах
          </Link>
        </div>
      </div>
    </div>
  );
}

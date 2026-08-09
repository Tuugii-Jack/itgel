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
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg px-3 py-3">
        <Link href="/" aria-label="Буцах" className="no-underline">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#1C1917" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4 L6 10 L12 16" />
          </svg>
        </Link>
        <span className="text-[15px]">Захиалга хянах</span>
      </div>

      <div className="px-4 pt-6">
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

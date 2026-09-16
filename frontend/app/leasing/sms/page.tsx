"use client";

import { useMemo, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { Button, Card, ErrorNote, Field, Textarea } from "@/components/ui";
import { leasingApi, ApiError } from "@/lib/api";
import { phoneLabel } from "@/lib/format";
import { useToast } from "@/lib/toast";

const MAX_CHARS = 210;
const MAX_PHONES = 40;

function parsePhones(raw: string): { phones: string[]; invalid: string[] } {
  const parts = raw.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  const phones: string[] = [];
  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const part of parts) {
    const digits = part.replace(/\D/g, "");
    const phone = digits.startsWith("976") && digits.length === 11 ? digits.slice(3) : digits;
    if (!/^[5-9]\d{7}$/.test(phone)) {
      invalid.push(part);
      continue;
    }
    if (seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
  }
  return { phones, invalid };
}

export default function LeasingSmsPage() {
  const toast = useToast();
  const [rawPhones, setRawPhones] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parsePhones(rawPhones), [rawPhones]);
  const overLimit = parsed.phones.length > MAX_PHONES;
  const phones = overLimit ? parsed.phones.slice(0, MAX_PHONES) : parsed.phones;
  const chars = [...text].length;
  const canSend =
    phones.length >= 1 && !overLimit && text.trim().length >= 1 && chars <= MAX_CHARS;

  const send = async () => {
    if (!canSend || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await leasingApi.sendSms(phones, text.trim());
      const fail = result.failed.length;
      if (fail > 0) {
        setError(
          `${result.sent} илгээлээ, ${fail} алдаа: ${result.failed
            .map((f) => `${phoneLabel(f.phone)}: ${f.error}`)
            .join(" · ")}`,
        );
        toast.error("Зарим SMS илгээгдсэнгүй.");
        setRawPhones(result.failed.map((f) => f.phone).join("\n"));
      } else {
        toast.success(
          result.sent === 1
            ? `${phoneLabel(result.phone)} руу илгээлээ.`
            : `${result.sent} дугаар руу илгээлээ.`,
        );
        setRawPhones("");
        setText("");
      }
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Илгээж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[520px]">
      <PageHead
        title="SMS"
        hint="Нэг эсвэл олон 8 оронтой дугаар руу ижил мессеж илгээнэ."
      />
      <Card className="flex flex-col gap-4 p-4">
        <Field
          label="Утасны дугаар"
          hint="Нэг мөрөнд нэг, эсвэл таслалаар. Ихдээ 40."
        >
          <Textarea
            value={rawPhones}
            onChange={setRawPhones}
            placeholder={"99112233\n88112233"}
            rows={4}
            resize="y"
          />
        </Field>
        {rawPhones.trim() && (
          <div className="text-[13px] leading-[1.5]">
            {phones.length > 0 && (
              <div className="text-ink-2">
                Зөв {phones.length} дугаар
                {overLimit ? ` · эхний ${MAX_PHONES}` : ""}:{" "}
                <span className="tnum">{phones.map(phoneLabel).join(", ")}</span>
              </div>
            )}
            {overLimit && (
              <div className="mt-1 text-danger">Нэг удаад {MAX_PHONES}-с илүүгүй.</div>
            )}
            {parsed.invalid.length > 0 && (
              <div className="mt-1 text-danger">
                Буруу: {parsed.invalid.join(", ")}
              </div>
            )}
          </div>
        )}
        <Field
          label="Мессеж"
          hint={`Холбоос оруулбал хасагдана. Кирилл 70 тэмдэгт = 1 SMS. ${chars}/${MAX_CHARS}`}
        >
          <Textarea
            value={text}
            onChange={(v) => setText([...v].slice(0, MAX_CHARS).join(""))}
            placeholder="Жишээ: itgel PH-XXXXXX төлбөрөө төлнө үү."
            rows={5}
            resize="y"
          />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button full onClick={() => void send()} loading={busy} disabled={!canSend}>
          {phones.length > 1 ? `${phones.length} дугаар руу илгээх` : "Илгээх"}
        </Button>
      </Card>
    </div>
  );
}

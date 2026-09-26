"use client";

import { useMemo, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { Button, Card, ErrorNote, Field, Textarea } from "@/components/ui";
import { leasingApi, ApiError } from "@/lib/api";
import { phoneLabel } from "@/lib/format";
import { smsStatusLabel, smsToastForSend } from "@/lib/smsStatus";
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
  const [draft, setDraft] = useState<{
    sender: string | null;
    text: string;
    chars: number;
    segments: number;
    phones: string[];
    previewToken: string;
  } | null>(null);

  const parsed = useMemo(() => parsePhones(rawPhones), [rawPhones]);
  const overLimit = parsed.phones.length > MAX_PHONES;
  const phones = overLimit ? parsed.phones.slice(0, MAX_PHONES) : parsed.phones;
  const chars = [...text].length;
  const canPreview =
    phones.length >= 1 && !overLimit && text.trim().length >= 1 && chars <= MAX_CHARS;

  const preview = async () => {
    if (!canPreview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await leasingApi.previewSms(phones, text.trim());
      setDraft({
        sender: data.sender,
        text: data.text,
        chars: data.chars,
        segments: data.segments,
        phones: data.phones,
        previewToken: data.previewToken,
      });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Урьдчилан харж чадсангүй.";
      setError(message);
      toast.error(message);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await leasingApi.sendSms(draft.phones, draft.text, draft.previewToken, crypto.randomUUID());
      const fail = result.failed.length;
      if (fail > 0) {
        setError(
          `Хүлээгдэж буй ${result.pending ?? 0}, хүргэгдсэн ${result.delivered ?? 0}, ${fail} алдаа: ${result.failed
            .map((f) => `${phoneLabel(f.phone)}: ${f.error}`)
            .join(" · ")}`,
        );
        toast.error("Зарим SMS илгээгдсэнгүй.");
        setRawPhones(result.failed.map((f) => f.phone).join("\n"));
        setDraft(null);
      } else {
        const note = smsToastForSend({
          sent: result.sent,
          pending: result.pending,
          delivered: result.delivered,
          unknown: result.unknown,
          failed: fail,
        });
        toast.success(note?.message ?? smsStatusLabel("queued"));
        setRawPhones("");
        setText("");
        setDraft(null);
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
            onChange={(v) => {
              setRawPhones(v);
              setDraft(null);
            }}
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
            onChange={(v) => {
              setText([...v].slice(0, MAX_CHARS).join(""));
              setDraft(null);
            }}
            placeholder="Жишээ: itgel PH-XXXXXX төлбөрөө төлнө үү."
            rows={5}
            resize="y"
          />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        {!draft ? (
          <Button full onClick={() => void preview()} loading={busy} disabled={!canPreview}>
            Урьдчилан харах
          </Button>
        ) : (
          <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-3">
            <div className="text-[14px] font-medium">Илгээхээс өмнө шалгах</div>
            <div className="text-[13px] text-ink-2">
              Суваг: лизинг{draft.sender ? ` · ${draft.sender}` : ""}
            </div>
            <div className="text-[13px] leading-[1.5]">{draft.text}</div>
            <div className="tnum text-[12px] text-muted">
              {draft.chars} тэмдэгт · {draft.segments} SMS · {draft.phones.length} дугаар
            </div>
            <div className="flex gap-2">
              <Button variant="outline" full onClick={() => setDraft(null)} disabled={busy}>
                Засах
              </Button>
              <Button full onClick={() => void send()} loading={busy}>
                {draft.phones.length} дугаарт илгээх
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

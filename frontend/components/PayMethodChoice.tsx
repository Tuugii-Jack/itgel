"use client";

/**
 * Сагс болон төлбөрийн самбарт ижил: QPay | Лизинг.
 */
export function PayMethodChoice({
  leasing,
  onChange,
  disabled,
  name = "pay-method",
}: {
  leasing: boolean;
  onChange: (leasing: boolean) => void;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] text-ink-2">Төлбөрийн хэлбэр</div>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-[8px] border border-line px-3 py-2.5">
        <input
          type="radio"
          name={name}
          checked={!leasing}
          disabled={disabled}
          onChange={() => onChange(false)}
          className="mt-1"
        />
        <span>
          <span className="block text-[14px] font-medium">QPay</span>
          <span className="block text-[13px] text-ink-2">
            Барааны үнийг одоо бүрэн төлнө.
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-[8px] border border-line px-3 py-2.5">
        <input
          type="radio"
          name={name}
          checked={leasing}
          disabled={disabled}
          onChange={() => onChange(true)}
          className="mt-1"
        />
        <span>
          <span className="block text-[14px] font-medium">Лизинг</span>
          <span className="block text-[13px] text-ink-2">
            Эхлээд 10% шимтгэл, дараа нь үндсэн 100%-ийг хувааж төлнө.
          </span>
        </span>
      </label>
      {leasing && (
        <div className="rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13px] leading-[1.6] text-ink-2">
          <div className="mb-1 font-medium text-ink">Лизингийн нөхцөл</div>
          Эхний төлөлт нь барааны үнийн 10% — лизингийн шимтгэл. Шимтгэл
          төлөгдсөний дараа барааны үндсэн 100%-ийг нэг удаа эсвэл хувааж төлнө.
          Шимтгэл нь барааны үнээс тусдаа.
        </div>
      )}
    </div>
  );
}

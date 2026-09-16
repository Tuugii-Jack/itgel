/**
 * Барааны тайлбар — «Энэ бараа хэрхэн ирэх вэ» хэсгийн оронд, яг тэр
 * байрлалд (desktop: үнэ ба key facts хооронд, mobile: qty stepper ба
 * доод CTA хооронд) гарна.
 */
export function ProductDescription({
  description,
  className = "",
}: {
  description: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[12px] border border-line bg-surface p-4 lg:p-5 ${className}`}
    >
      <div className='text-[15px] font-medium lg:text-[17px]'>Тайлбар</div>
      <div className='mt-2 text-[14px] leading-[1.75] text-ink-2 lg:mt-2.5 lg:max-w-[440px] lg:text-[15px]'>
        <p className='m-0 whitespace-pre-line'>{description}</p>
      </div>
    </div>
  );
}

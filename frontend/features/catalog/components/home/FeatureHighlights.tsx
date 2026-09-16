import { GUTTER } from "./constants";

export function FeatureHighlights() {
  return (
    <section className={`${GUTTER} mt-24 pt-10 sm:pt-12`}>
      <div className='grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2'>
        <FeatureItem icon='delivery' text='Хурдан шуурхай хүргэлт' />

        <FeatureItem icon='quality' text='Үйлдвэрийн үнэ, чанартай бараа' />

        <FeatureItem icon='clock' text='Захиалга 15-20 хоногт' />

        <FeatureItem
          icon='refund'
          text='Сар бүрийн 10, 20, 30-нд буцаалт хийнэ'
        />
      </div>
    </section>
  );
}

const FEATURE_ICONS = {
  delivery: (
    <>
      <path d='M2.5 6h9v8h-9z' />
      <path d='M11.5 9h3.2l2.8 2.8V14h-6z' />
      <circle cx='6' cy='15.3' r='1.6' />
      <circle cx='14.5' cy='15.3' r='1.6' />
    </>
  ),

  quality: (
    <>
      <path d='M10 2.5 12.4 7.4 17.8 8.2 13.9 12 14.8 17.4 10 14.8 5.2 17.4 6.1 12 2.2 8.2 7.6 7.4z' />
    </>
  ),

  clock: (
    <>
      <circle cx='10' cy='10' r='7.5' />
      <path d='M10 5.5V10l3 2' />
    </>
  ),

  refund: (
    <>
      <path d='M4 10a6 6 0 1 1 1.76 4.24' />
      <path d='M4 14.5V10h4.5' />
    </>
  ),
} as const;


function FeatureItem({
  icon,
  text,
}: {
  icon: keyof typeof FEATURE_ICONS;
  text: string;
}) {
  return (
    <div
      className='
        group flex min-h-[110px]
        items-center gap-5
        rounded-[16px]
        border border-line
        bg-surface
        p-5
        transition-all duration-200
        hover:border-primary/30
        hover:bg-primary-soft/30
        sm:min-h-[130px]
        sm:p-6
        lg:min-h-[150px]
        lg:gap-7
        lg:p-8
      '
    >
      <span
        className='
          flex h-16 w-16 shrink-0
          items-center justify-center
          rounded-[14px]
          bg-primary-soft
          text-primary
          transition-transform
          duration-200
          group-hover:scale-105
          sm:h-[72px] sm:w-[72px]
          lg:h-20 lg:w-20
        '
      >
        <svg
          width='32'
          height='32'
          viewBox='0 0 20 20'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.6'
          strokeLinecap='round'
          strokeLinejoin='round'
          className='
            h-8 w-8
            sm:h-9 sm:w-9
            lg:h-10 lg:w-10
          '
          aria-hidden='true'
        >
          {FEATURE_ICONS[icon]}
        </svg>
      </span>

      <p
        className='
          m-0
          text-[16px]
          font-semibold
          leading-[1.4]
          text-ink
          sm:text-[18px]
          lg:text-[21px]
        '
      >
        {text}
      </p>
    </div>
  );
}

import { GUTTER } from "./constants";

export function MapSection() {
  return (
    <section className={`${GUTTER} pt-10 sm:pt-12`}>
      <div className='mb-4 sm:mb-5'>
        <h2
          className='
            m-0 text-[20px]
            font-medium
            leading-[1.3]
            text-ink
            lg:text-[24px]
          '
        >
          Байршил
        </h2>
      </div>

      <div
        className='
          overflow-hidden
          rounded-[12px]
          border border-line
          shadow-sm
        '
      >
        <iframe
          src='https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d1442.7921895504498!2d106.81608800881027!3d47.868954615688175!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x5d96950010502423%3A0xfd23c0e1847d600c!2sItgel%20shop!5e1!3m2!1sen!2smn!4v1786613105055!5m2!1sen!2smn'
          width='600'
          height='450'
          style={{ border: 0 }}
          allowFullScreen
          loading='lazy'
          referrerPolicy='strict-origin-when-cross-origin'
          className='block h-[300px] w-full sm:h-[400px] lg:h-[450px]'
        />
      </div>
    </section>
  );
}

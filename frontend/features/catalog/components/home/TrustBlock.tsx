import Image from "next/image";
import type { ReactNode } from "react";
import { Divider } from "@/components/ui";
import type { Store } from "@/lib/types";
import { GUTTER } from "./constants";

export function TrustBlock({ store }: { store: Store }) {
  return (
    <section
      className='
        relative z-10
        mt-10
        sm:mt-12
      '
    >
      <div
        className='
          rounded-none
          border-x-0
          border-b-0
          border-t border-line
          bg-primary-soft/60
          p-5
          sm:p-6
          lg:p-8
        '
      >
        <div className={GUTTER}>
          <div
            className='
              flex flex-col gap-5
              sm:flex-row
              sm:items-start
              sm:gap-6
            '
          >
            {/* Logo */}
            <div className='shrink-0'>
              <Image
                src='/logo.webp'
                alt={store.storeName ?? "itgel"}
                width={48}
                height={48}
                priority
                className='
                  h-11 w-auto
                  sm:h-12
                '
              />
            </div>

            {/* Store information */}
            <div className='min-w-0 flex-1'>
              <div
                className='
                  grid gap-3.5
                  text-[14px]
                  sm:grid-cols-2
                  sm:gap-x-8
                  sm:gap-y-4
                '
              >
                <InfoRow label='Хаяг' value={store.address} />

                <InfoRow label='Ажлын цаг' value={store.workHours} />

                <InfoRow
                  label='Утас'
                  value={
                    <a
                      href={`tel:${store.phone.replace(/\D/g, "")}`}
                      className='
                        tnum text-primary
                        hover:underline
                      '
                    >
                      {store.phone}
                    </a>
                  }
                />

                {store.facebookUrl && (
                  <InfoRow
                    label='Facebook'
                    value={
                      <a
                        href={store.facebookUrl}
                        target='_blank'
                        rel='noreferrer'
                        className='
                          break-all
                          text-primary
                          hover:underline
                        '
                      >
                        {store.facebookUrl.replace(/^https?:\/\//, "")}
                      </a>
                    }
                  />
                )}
              </div>
            </div>
          </div>

          <Divider className='my-5 sm:my-6' />

          <p
            className='
              m-0
              text-[12px]
              text-muted
              sm:text-[13px]
            '
          >
            © {new Date().getFullYear()} {store.storeName}
          </p>
        </div>
      </div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className='min-w-0'>
      <div
        className='
          text-[11px]
          font-medium
          uppercase
          tracking-wide
          text-muted
          sm:text-[12px]
        '
      >
        {label}
      </div>

      <div
        className='
          mt-0.5
          break-words
          leading-[1.5]
          text-ink
        '
      >
        {value}
      </div>
    </div>
  );
}

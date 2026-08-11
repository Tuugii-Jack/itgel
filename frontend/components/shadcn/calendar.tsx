"use client";

import * as React from "react";
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
} from "react-day-picker";
import { mn } from "react-day-picker/locale";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import "react-day-picker/style.css";

const WEEKDAYS = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"] as const;

/**
 * itgel календарь — RDP table layout + монгол гариг (Даваагаар эхэлнэ).
 * classNames-д default `rdp-*`-ийг хадгална (nav байрлал эвдэрнэ).
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  locale = mn,
  weekStartsOn = 1,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const d = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={weekStartsOn}
      locale={locale}
      navLayout="around"
      className={cn(
        "rdp-itgel [--rdp-accent-color:var(--color-primary)] [--rdp-accent-background-color:var(--color-primary-soft)] [--rdp-today-color:var(--color-primary-dark)] [--rdp-day-height:2.75rem] [--rdp-day-width:2.75rem] [--rdp-day_button-height:2.5rem] [--rdp-day_button-width:2.5rem] [--rdp-day_button-border-radius:10px] [--rdp-nav_button-width:2.25rem] [--rdp-nav_button-height:2.25rem]",
        className,
      )}
      formatters={{
        formatWeekdayName: (date) => WEEKDAYS[date.getDay()] ?? "",
        formatCaption: (date) =>
          `${date.getFullYear()} оны ${date.getMonth() + 1}-р сар`,
        ...formatters,
      }}
      classNames={{
        root: cn(d.root, "mx-auto w-full max-w-fit"),
        months: cn(d.months, "w-full max-w-fit"),
        month: cn(d.month, "w-full"),
        month_caption: cn(d.month_caption, "text-[15px] font-medium text-ink"),
        caption_label: cn(d.caption_label, "text-[15px] font-medium text-ink"),
        button_previous: cn(
          d.button_previous,
          "rounded-[8px] text-ink-2 hover:bg-surface-2 hover:text-ink",
        ),
        button_next: cn(
          d.button_next,
          "rounded-[8px] text-ink-2 hover:bg-surface-2 hover:text-ink",
        ),
        chevron: cn(d.chevron, "fill-none text-current"),
        weekday: cn(d.weekday, "text-[12px] font-medium text-ink-2"),
        day: cn(d.day, "text-[15px] text-ink"),
        selected: cn(d.selected, "font-medium"),
        today: cn(d.today, "font-medium"),
        outside: cn(d.outside, "text-muted"),
        disabled: cn(d.disabled, "text-muted"),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass, ...chevronProps }) => {
          const Icon = orientation === "left" ? ChevronLeftIcon : ChevronRightIcon;
          return (
            <Icon
              className={cn("size-4", chevronClass)}
              aria-hidden
              {...chevronProps}
            />
          );
        },
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <button
      ref={ref}
      type="button"
      data-day={day.date.toISOString()}
      className={cn(
        "rdp-day_button",
        modifiers.selected &&
          !modifiers.range_start &&
          !modifiers.range_end &&
          !modifiers.range_middle &&
          "bg-[var(--rdp-accent-color)] text-white border-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };

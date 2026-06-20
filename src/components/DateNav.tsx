"use client";

import { useState } from "react";
import { Button } from "@heroui/react/button";
import { Calendar } from "@heroui/react/calendar";
import { Popover } from "@heroui/react/popover";
import { parseDate } from "@internationalized/date";
import type { CalendarDate } from "@internationalized/date";

interface DateNavProps {
  dates: string[];
  currentDate?: string;
  onDateChange: (date: string) => void;
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatLabel(dateStr: string): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const todayStr = toLocalDateStr(today);
  const yesterdayStr = toLocalDateStr(yesterday);

  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";

  const date = new Date(dateStr + "T00:00:00");
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const year = date.getFullYear();
  return `${weekday}, ${day} ${month} ${year}`;
}

export function DateNav({ dates, currentDate, onDateChange }: DateNavProps) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const currentIndex = currentDate ? dates.indexOf(currentDate) : 0;
  const hasPrev = currentIndex < dates.length - 1;
  const hasNext = currentIndex > 0;
  const displayDate = currentDate ?? dates[0];

  const datesSet = new Set(dates);
  const todayStr = toLocalDateStr(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = toLocalDateStr(yesterdayDate);

  function goBack() {
    if (hasPrev) onDateChange(dates[currentIndex + 1]);
  }

  function goForward() {
    if (hasNext) onDateChange(dates[currentIndex - 1]);
  }

  function handleCalendarChange(date: CalendarDate | null) {
    if (date) {
      onDateChange(date.toString());
      setIsCalendarOpen(false);
    }
  }

  if (dates.length === 0) {
    return (
      <div className="flex items-center gap-4 animate-pulse">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-border">
          <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div className="font-serif text-xl w-[200px] text-center">
          <div className="h-6 w-32 mx-auto bg-border rounded" />
        </div>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-border">
          <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={goBack}
        disabled={!hasPrev}
        className="text-muted hover:text-foreground transition-colors disabled:opacity-20"
        aria-label="Previous date"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <Popover.Root isOpen={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <Popover.Trigger>
          <h1 className="font-serif text-xl font-medium tracking-tight text-foreground w-[200px] text-center cursor-pointer hover:opacity-70 transition-opacity">
            {formatLabel(displayDate)}
          </h1>
        </Popover.Trigger>
        <Popover.Content>
          <Popover.Dialog>
            <Calendar
              value={parseDate(displayDate)}
              onChange={handleCalendarChange}
              isDateUnavailable={(date) => !datesSet.has(date.toString())}
            >
              <Calendar.Header className="flex w-full items-center justify-between">
                <Calendar.YearPickerTrigger>
                  <Calendar.YearPickerTriggerHeading />
                  <Calendar.YearPickerTriggerIndicator />
                </Calendar.YearPickerTrigger>
                <div className="flex items-center gap-1">
                  <Calendar.NavButton slot="previous" />
                  <Calendar.NavButton slot="next" />
                </div>
              </Calendar.Header>
              <Calendar.YearPickerGrid>
                <Calendar.YearPickerGridBody>
                  {({ year }) => <Calendar.YearPickerCell year={year} />}
                </Calendar.YearPickerGridBody>
              </Calendar.YearPickerGrid>
              <Calendar.Grid>
                <Calendar.GridHeader>
                  {(day) => (
                    <Calendar.HeaderCell>{day}</Calendar.HeaderCell>
                  )}
                </Calendar.GridHeader>
                <Calendar.GridBody>
                  {(date) => <Calendar.Cell date={date} />}
                </Calendar.GridBody>
              </Calendar.Grid>
            </Calendar>
            <div className="flex items-center gap-2 border-t border-default pt-2 mt-2">
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                isDisabled={!datesSet.has(yesterdayStr)}
                onPress={() => {
                  onDateChange(yesterdayStr);
                  setIsCalendarOpen(false);
                }}
              >
                Yesterday
              </Button>
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                isDisabled={!datesSet.has(todayStr)}
                onPress={() => {
                  onDateChange(todayStr);
                  setIsCalendarOpen(false);
                }}
              >
                Today
              </Button>
            </div>
          </Popover.Dialog>
        </Popover.Content>
      </Popover.Root>
      <button
        onClick={goForward}
        disabled={!hasNext}
        className="text-muted hover:text-foreground transition-colors disabled:opacity-20"
        aria-label="Next date"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}

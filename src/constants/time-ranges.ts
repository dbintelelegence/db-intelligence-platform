import type { TimeRange } from '@/types';
import { subHours, subDays, subMonths } from 'date-fns';

export const TIME_RANGE_OPTIONS = [
  {
    label: 'Last hour',
    value: '1h',
    getRange: (): TimeRange => ({
      start: subHours(new Date(), 1),
      end: new Date(),
      label: 'Last hour',
    }),
  },
  {
    label: 'Last 24 hours',
    value: '24h',
    getRange: (): TimeRange => ({
      start: subHours(new Date(), 24),
      end: new Date(),
      label: 'Last 24 hours',
    }),
  },
  {
    label: 'Last 7 days',
    value: '7d',
    getRange: (): TimeRange => ({
      start: subDays(new Date(), 7),
      end: new Date(),
      label: 'Last 7 days',
    }),
  },
  {
    label: 'Last 30 days',
    value: '30d',
    getRange: (): TimeRange => ({
      start: subDays(new Date(), 30),
      end: new Date(),
      label: 'Last 30 days',
    }),
  },
  {
    label: 'Last 3 months',
    value: '90d',
    getRange: (): TimeRange => ({
      start: subMonths(new Date(), 3),
      end: new Date(),
      label: 'Last 3 months',
    }),
  },
] as const;

export function getDefaultTimeRange(): TimeRange {
  return TIME_RANGE_OPTIONS[1].getRange(); // Last 24 hours
}

export function getTimeRangeByValue(value: string): TimeRange {
  const option = TIME_RANGE_OPTIONS.find(opt => opt.value === value);
  return option ? option.getRange() : getDefaultTimeRange();
}

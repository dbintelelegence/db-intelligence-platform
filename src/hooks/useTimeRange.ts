import { useState } from 'react';
import { subHours, subDays } from 'date-fns';

export type TimeRangeOption = '1h' | '24h' | '7d' | '30d' | 'custom';

export interface TimeRange {
  value: TimeRangeOption;
  start: Date;
  end: Date;
}

function calculateTimeRange(option: TimeRangeOption): TimeRange {
  const end = new Date();
  let start: Date;

  switch (option) {
    case '1h':
      start = subHours(end, 1);
      break;
    case '24h':
      start = subHours(end, 24);
      break;
    case '7d':
      start = subDays(end, 7);
      break;
    case '30d':
      start = subDays(end, 30);
      break;
    default:
      start = subDays(end, 1);
  }

  return { value: option, start, end };
}

export function useTimeRange(defaultValue: TimeRangeOption = '24h') {
  const [timeRange, setTimeRange] = useState<TimeRange>(
    calculateTimeRange(defaultValue)
  );

  const updateTimeRange = (option: TimeRangeOption) => {
    setTimeRange(calculateTimeRange(option));
  };

  return { timeRange, setTimeRange: updateTimeRange };
}

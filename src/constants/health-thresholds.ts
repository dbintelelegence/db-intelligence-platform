import type { HealthStatus } from '@/types';

export const HEALTH_THRESHOLDS = {
  EXCELLENT: 95,
  GOOD: 85,
  WARNING: 70,
} as const;

export const HEALTH_COLORS = {
  excellent: 'bg-green-500 text-white',
  good: 'bg-green-400 text-white',
  warning: 'bg-amber-500 text-white',
  critical: 'bg-red-500 text-white',
  unknown: 'bg-gray-400 text-white',
} as const;

export const HEALTH_TEXT_COLORS = {
  excellent: 'text-green-500',
  good: 'text-green-400',
  warning: 'text-amber-500',
  critical: 'text-red-500',
  unknown: 'text-gray-400',
} as const;

export const HEALTH_BORDER_COLORS = {
  excellent: 'border-green-500',
  good: 'border-green-400',
  warning: 'border-amber-500',
  critical: 'border-red-500',
  unknown: 'border-gray-400',
} as const;

export function getHealthStatus(score: number): HealthStatus {
  if (score < 0) return 'unknown';
  if (score >= HEALTH_THRESHOLDS.EXCELLENT) return 'excellent';
  if (score >= HEALTH_THRESHOLDS.GOOD) return 'good';
  if (score >= HEALTH_THRESHOLDS.WARNING) return 'warning';
  return 'critical';
}

export function getHealthColor(status: HealthStatus): string {
  return HEALTH_COLORS[status];
}

export function getHealthTextColor(status: HealthStatus): string {
  return HEALTH_TEXT_COLORS[status];
}

export function getHealthBorderColor(status: HealthStatus): string {
  return HEALTH_BORDER_COLORS[status];
}

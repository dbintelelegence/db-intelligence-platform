import { Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CloudProvider } from '@/types';

interface CloudIconProps {
  cloud: CloudProvider;
  className?: string;
}

export function CloudIcon({ cloud, className }: CloudIconProps) {
  const colors = {
    aws: 'text-orange-600 dark:text-orange-400',
    gcp: 'text-blue-600 dark:text-blue-400',
    azure: 'text-sky-600 dark:text-sky-400',
  };

  return (
    <div className={cn('rounded-lg p-2 bg-muted', className)}>
      <Cloud className={cn('h-5 w-5', colors[cloud])} />
    </div>
  );
}

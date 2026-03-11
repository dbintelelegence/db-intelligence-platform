import { Badge } from '@/components/ui/badge';
import { AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';

interface SeverityBadgeProps {
  critical: number;
  warning: number;
}

export function SeverityBadge({ critical, warning }: SeverityBadgeProps) {
  if (critical > 0) {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" />
        {critical} Critical
      </Badge>
    );
  }

  if (warning > 0) {
    return (
      <Badge className="gap-1 bg-yellow-500 hover:bg-yellow-600 text-white">
        <AlertTriangle className="h-3 w-3" />
        {warning} Warning
      </Badge>
    );
  }

  return (
    <Badge className="gap-1 bg-green-500 hover:bg-green-600 text-white">
      <CheckCircle className="h-3 w-3" />
      All Healthy
    </Badge>
  );
}

import { useState, useMemo } from 'react';
import { ArrowUp, ArrowDown, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { DatabaseCost } from '@/types';

interface CostBreakdownTableProps {
  costs: DatabaseCost[];
  onRowClick: (cost: DatabaseCost) => void;
}

type SortKey = 'name' | 'total' | 'compute' | 'storage' | 'backup' | 'transfer';
type SortDirection = 'asc' | 'desc';

export function CostBreakdownTable({ costs, onRowClick }: CostBreakdownTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const sortedCosts = useMemo(() => {
    return [...costs].sort((a, b) => {
      let aValue: number | string;
      let bValue: number | string;

      switch (sortKey) {
        case 'name':
          aValue = a.databaseName.toLowerCase();
          bValue = b.databaseName.toLowerCase();
          break;
        case 'total':
          aValue = a.totalCost;
          bValue = b.totalCost;
          break;
        case 'compute':
          aValue = a.breakdown.compute;
          bValue = b.breakdown.compute;
          break;
        case 'storage':
          aValue = a.breakdown.storage;
          bValue = b.breakdown.storage;
          break;
        case 'backup':
          aValue = a.breakdown.backup;
          bValue = b.breakdown.backup;
          break;
        case 'transfer':
          aValue = a.breakdown.dataTransfer;
          bValue = b.breakdown.dataTransfer;
          break;
        default:
          aValue = a.totalCost;
          bValue = b.totalCost;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return sortDirection === 'asc'
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });
  }, [costs, sortKey, sortDirection]);

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) {
      return <ArrowUp className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-50" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="h-4 w-4" />
    ) : (
      <ArrowDown className="h-4 w-4" />
    );
  };

  const TrendIndicator = ({ direction, change }: { direction: 'up' | 'down' | 'stable'; change: number }) => {
    if (direction === 'stable') {
      return (
        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <Minus className="h-3 w-3" />
          <span>Stable</span>
        </div>
      );
    }

    const isPositive = direction === 'down';
    return (
      <div className={cn(
        'flex items-center gap-1 text-xs font-medium',
        isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
      )}>
        {direction === 'up' ? (
          <TrendingUp className="h-3 w-3" />
        ) : (
          <TrendingDown className="h-3 w-3" />
        )}
        <span>{Math.abs(change).toFixed(1)}%</span>
      </div>
    );
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left">
                <button
                  onClick={() => handleSort('name')}
                  className="group flex items-center gap-2 text-sm font-semibold hover:text-foreground transition-colors"
                >
                  Database
                  <SortIcon column="name" />
                </button>
              </th>
              <th className="px-4 py-3 text-right">
                <button
                  onClick={() => handleSort('total')}
                  className="group flex items-center justify-end gap-2 text-sm font-semibold hover:text-foreground transition-colors ml-auto"
                >
                  Total Cost
                  <SortIcon column="total" />
                </button>
              </th>
              <th className="px-4 py-3 text-right">
                <button
                  onClick={() => handleSort('compute')}
                  className="group flex items-center justify-end gap-2 text-sm font-semibold hover:text-foreground transition-colors ml-auto"
                >
                  Compute
                  <SortIcon column="compute" />
                </button>
              </th>
              <th className="px-4 py-3 text-right">
                <button
                  onClick={() => handleSort('storage')}
                  className="group flex items-center justify-end gap-2 text-sm font-semibold hover:text-foreground transition-colors ml-auto"
                >
                  Storage
                  <SortIcon column="storage" />
                </button>
              </th>
              <th className="px-4 py-3 text-right">
                <button
                  onClick={() => handleSort('backup')}
                  className="group flex items-center justify-end gap-2 text-sm font-semibold hover:text-foreground transition-colors ml-auto"
                >
                  Backup
                  <SortIcon column="backup" />
                </button>
              </th>
              <th className="px-4 py-3 text-right">
                <button
                  onClick={() => handleSort('transfer')}
                  className="group flex items-center justify-end gap-2 text-sm font-semibold hover:text-foreground transition-colors ml-auto"
                >
                  Transfer
                  <SortIcon column="transfer" />
                </button>
              </th>
              <th className="px-4 py-3 text-center text-sm font-semibold">Trend</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sortedCosts.map((cost) => (
              <tr
                key={cost.databaseId}
                onClick={() => onRowClick(cost)}
                className="hover:bg-muted/50 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3">
                  <span className="font-medium">{cost.databaseName}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-semibold">{formatCurrency(cost.totalCost)}</span>
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {formatCurrency(cost.breakdown.compute)}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {formatCurrency(cost.breakdown.storage)}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {formatCurrency(cost.breakdown.backup)}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {formatCurrency(cost.breakdown.dataTransfer)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-center">
                    <TrendIndicator
                      direction={cost.trend.direction}
                      change={cost.trend.change}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

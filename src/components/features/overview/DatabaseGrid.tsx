import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Database } from '@/types';
import { HealthBadge } from '@/components/common/HealthBadge';
import { formatCurrency } from '@/lib/formatters';
import { ArrowUp, ArrowDown, AlertCircle, ChevronUp, ChevronDown, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DatabaseGridProps {
  databases: Database[];
}

type SortField = 'cost' | 'issues' | null;
type SortDir = 'asc' | 'desc';

export function DatabaseGrid({ databases }: DatabaseGridProps) {
  const navigate = useNavigate();

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterCloud, setFilterCloud] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  const [filterEnv, setFilterEnv] = useState('');
  const [filterHealth, setFilterHealth] = useState('');

  // Sort state
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortField(null); setSortDir('asc'); }
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Unique values for dropdown filters
  const uniqueTypes = useMemo(() => [...new Set(databases.map(d => d.type))].sort(), [databases]);
  const uniqueClouds = useMemo(() => [...new Set(databases.map(d => d.cloud))].sort(), [databases]);
  const uniqueRegions = useMemo(() => [...new Set(databases.map(d => d.region))].sort(), [databases]);
  const uniqueEnvs = useMemo(() => [...new Set(databases.map(d => d.environment))].sort(), [databases]);
  const uniqueHealth = useMemo(() => [...new Set(databases.map(d => d.healthStatus))].sort(), [databases]);

  // Filter and sort
  const filteredDatabases = useMemo(() => {
    let result = databases.filter(db => {
      if (filterName && !db.name.toLowerCase().includes(filterName.toLowerCase())) return false;
      if (filterType && db.type !== filterType) return false;
      if (filterCloud && db.cloud !== filterCloud) return false;
      if (filterRegion && db.region !== filterRegion) return false;
      if (filterEnv && db.environment !== filterEnv) return false;
      if (filterHealth && db.healthStatus !== filterHealth) return false;
      return true;
    });

    if (sortField) {
      result = [...result].sort((a, b) => {
        const valA = sortField === 'cost' ? a.monthlyCost : a.activeIssues;
        const valB = sortField === 'cost' ? b.monthlyCost : b.activeIssues;
        return sortDir === 'asc' ? valA - valB : valB - valA;
      });
    }

    return result;
  }, [databases, filterName, filterType, filterCloud, filterRegion, filterEnv, filterHealth, sortField, sortDir]);

  const getCloudBadgeColor = (cloud: string) => {
    const colors = {
      aws: 'bg-orange-100 text-orange-800 border-orange-200',
      gcp: 'bg-blue-100 text-blue-800 border-blue-200',
      azure: 'bg-sky-100 text-sky-800 border-sky-200',
    };
    return colors[cloud as keyof typeof colors] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getEnvBadgeColor = (env: string) => {
    const colors = {
      production: 'bg-purple-100 text-purple-800 border-purple-200',
      staging: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      qa: 'bg-teal-100 text-teal-800 border-teal-200',
      development: 'bg-gray-100 text-gray-800 border-gray-200',
    };
    return colors[env as keyof typeof colors] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getMetricColor = (value: number) => {
    if (value > 85) return 'text-red-600';
    if (value > 70) return 'text-amber-600';
    return '';
  };

  const SortIndicator = ({ field }: { field: SortField }) => (
    <span className="inline-flex flex-col ml-1">
      <ChevronUp className={cn('h-3 w-3 -mb-1', sortField === field && sortDir === 'asc' ? 'text-foreground' : 'text-muted-foreground/40')} />
      <ChevronDown className={cn('h-3 w-3', sortField === field && sortDir === 'desc' ? 'text-foreground' : 'text-muted-foreground/40')} />
    </span>
  );

  const cellClickClass = 'cursor-pointer hover:text-primary hover:underline';
  const cellWrapClass = 'hover:bg-muted/30 rounded px-1 -mx-1 transition-colors';

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Filter toggle */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <span className="text-sm text-muted-foreground">
          {filteredDatabases.length} of {databases.length} databases
        </span>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            'flex items-center gap-1.5 text-sm px-2 py-1 rounded hover:bg-muted transition-colors',
            showFilters && 'bg-muted'
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold">Name</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Type</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Cloud</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Region</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Environment</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Health</th>
              <th className="px-4 py-3 text-right text-sm font-semibold w-16">CPU</th>
              <th className="px-4 py-3 text-right text-sm font-semibold w-16">Mem</th>
              <th className="px-4 py-3 text-right text-sm font-semibold w-16">Disk</th>
              <th
                className="px-4 py-3 text-right text-sm font-semibold cursor-pointer select-none"
                onClick={() => toggleSort('cost')}
              >
                <span className="inline-flex items-center">
                  Cost/mo
                  <SortIndicator field="cost" />
                </span>
              </th>
              <th
                className="pl-4 pr-0 py-3 text-center text-sm font-semibold cursor-pointer select-none"
                onClick={() => toggleSort('issues')}
              >
                <span className="inline-flex items-center">
                  Issues
                  <SortIndicator field="issues" />
                </span>
              </th>
            </tr>
          </thead>

          {/* Filter row */}
          {showFilters && (
            <tbody className="border-b bg-muted/20">
              <tr>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    placeholder="Filter name…"
                    value={filterName}
                    onChange={(e) => setFilterName(e.target.value)}
                    className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </td>
                <td className="px-4 py-2">
                  <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full rounded border border-input bg-background px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                    <option value="">All</option>
                    {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <select value={filterCloud} onChange={(e) => setFilterCloud(e.target.value)} className="w-full rounded border border-input bg-background px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                    <option value="">All</option>
                    {uniqueClouds.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)} className="w-full rounded border border-input bg-background px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                    <option value="">All</option>
                    {uniqueRegions.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <select value={filterEnv} onChange={(e) => setFilterEnv(e.target.value)} className="w-full rounded border border-input bg-background px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                    <option value="">All</option>
                    {uniqueEnvs.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <select value={filterHealth} onChange={(e) => setFilterHealth(e.target.value)} className="w-full rounded border border-input bg-background px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                    <option value="">All</option>
                    {uniqueHealth.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </td>
                {/* CPU, Mem, Disk - no filter */}
                <td className="px-4 py-2" />
                <td className="px-4 py-2" />
                <td className="px-4 py-2" />
                {/* Cost, Issues - no filter */}
                <td className="px-4 py-2" />
                <td className="pl-4 pr-0 py-2" />
              </tr>
            </tbody>
          )}

          <tbody className="divide-y">
            {filteredDatabases.map((db) => (
              <tr
                key={db.id}
                className="hover:bg-muted/50 transition-colors"
              >
                {/* Name */}
                <td className="px-4 py-3">
                  <span
                    className={cn(cellClickClass, cellWrapClass, 'font-medium inline-block')}
                    onClick={() => navigate(`/databases/${db.id}`)}
                  >
                    {db.name}
                  </span>
                </td>

                {/* Type */}
                <td className="px-4 py-3">
                  <span
                    className={cn(cellClickClass, cellWrapClass, 'text-sm capitalize inline-block')}
                    onClick={() => navigate(`/databases?type=${db.type}`)}
                  >
                    {db.type}
                  </span>
                </td>

                {/* Cloud */}
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity',
                      getCloudBadgeColor(db.cloud)
                    )}
                    onClick={() => navigate(`/databases?cloud=${db.cloud}`)}
                  >
                    {db.cloud.toUpperCase()}
                  </span>
                </td>

                {/* Region */}
                <td className="px-4 py-3">
                  <span
                    className={cn(cellClickClass, cellWrapClass, 'text-sm text-muted-foreground inline-block')}
                    onClick={() => navigate(`/databases?cloud=${db.cloud}&region=${db.region}`)}
                  >
                    {db.region}
                  </span>
                </td>

                {/* Environment */}
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium capitalize cursor-pointer hover:opacity-80 transition-opacity',
                      getEnvBadgeColor(db.environment)
                    )}
                    onClick={() => navigate(`/databases?environment=${db.environment}`)}
                  >
                    {db.environment}
                  </span>
                </td>

                {/* Health */}
                <td className="px-4 py-3">
                  <span
                    className="cursor-pointer hover:opacity-80 transition-opacity inline-block"
                    onClick={() => navigate(`/databases/${db.id}#overview`)}
                  >
                    <HealthBadge status={db.healthStatus} score={db.healthScore} size="sm" />
                  </span>
                </td>

                {/* CPU */}
                <td className="px-4 py-3 text-right">
                  <span className={cn('text-sm tabular-nums', getMetricColor(db.metrics.cpu))}>
                    {db.metrics.cpu}%
                  </span>
                </td>

                {/* Memory */}
                <td className="px-4 py-3 text-right">
                  <span className={cn('text-sm tabular-nums', getMetricColor(db.metrics.memory))}>
                    {db.metrics.memory}%
                  </span>
                </td>

                {/* Disk */}
                <td className="px-4 py-3 text-right">
                  <span className={cn('text-sm tabular-nums', getMetricColor(db.metrics.storage))}>
                    {db.metrics.storage}%
                  </span>
                </td>

                {/* Cost */}
                <td className="px-4 py-3 text-right">
                  <span
                    className={cn(cellClickClass, cellWrapClass, 'inline-block')}
                    onClick={() => navigate(`/databases/${db.id}#cost`)}
                  >
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-medium">{formatCurrency(db.monthlyCost)}</span>
                      <div className="flex items-center gap-1 text-xs">
                        {db.costTrend === 'up' && (
                          <>
                            <ArrowUp className="h-3 w-3 text-red-500" />
                            <span className="text-red-600">+12%</span>
                          </>
                        )}
                        {db.costTrend === 'down' && (
                          <>
                            <ArrowDown className="h-3 w-3 text-green-500" />
                            <span className="text-green-600">-8%</span>
                          </>
                        )}
                        {db.costTrend === 'stable' && (
                          <span className="text-muted-foreground">stable</span>
                        )}
                      </div>
                    </div>
                  </span>
                </td>

                {/* Issues */}
                <td className="pl-4 pr-0 py-3 text-center">
                  <span
                    className={cn('inline-block cursor-pointer hover:opacity-80 transition-opacity', cellWrapClass)}
                    onClick={() => navigate(`/issues?database=${db.id}`)}
                  >
                    {db.activeIssues > 0 ? (
                      <div className="flex items-center justify-center gap-1">
                        <AlertCircle className="h-4 w-4 text-red-500" />
                        <span className="font-medium text-red-600">{db.activeIssues}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

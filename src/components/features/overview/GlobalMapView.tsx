import { useMemo } from 'react';
import type { Database } from '@/types';
import {
  createRegionMarkers,
  getMarkerColor,
  getMarkerSize,
  type RegionMarker,
} from '@/utils/map-coordinates';

interface GlobalMapViewProps {
  databases: Database[];
  selectedMarker: RegionMarker | null;
  onMarkerSelect: (marker: RegionMarker) => void;
}

export function GlobalMapView({
  databases,
  selectedMarker,
  onMarkerSelect,
}: GlobalMapViewProps) {
  const markers = useMemo(
    () => createRegionMarkers(databases),
    [databases]
  );

  return (
    <div className="w-full bg-card rounded-lg border p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Global Fleet Health Map</h3>
        <p className="text-sm text-muted-foreground">
          Click any region marker to view details
        </p>
      </div>

      {/* SVG Map Container */}
      <div className="relative w-full aspect-[2/1] bg-muted/30 rounded-lg overflow-hidden">
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          style={{ backgroundColor: '#f8f9fa' }}
        >
          {/* Simplified world map outline - just continents as basic shapes */}
          <g opacity="0.2" fill="#94a3b8">
            {/* North America */}
            <path d="M 10,25 L 8,28 L 8,35 L 10,40 L 15,42 L 20,42 L 25,40 L 28,35 L 30,30 L 28,25 L 25,23 L 20,23 L 15,24 Z" />

            {/* South America */}
            <path d="M 25,45 L 23,50 L 23,58 L 25,63 L 28,65 L 32,65 L 35,62 L 36,55 L 35,48 L 32,45 Z" />

            {/* Europe */}
            <path d="M 45,22 L 43,25 L 43,32 L 45,35 L 50,35 L 55,33 L 58,28 L 58,24 L 55,22 Z" />

            {/* Africa */}
            <path d="M 48,38 L 46,42 L 46,55 L 48,62 L 52,65 L 56,65 L 60,62 L 62,55 L 62,45 L 60,40 L 56,38 Z" />

            {/* Asia */}
            <path d="M 62,20 L 60,25 L 60,35 L 62,40 L 68,42 L 75,42 L 82,40 L 88,35 L 90,28 L 88,22 L 82,20 L 75,20 Z" />

            {/* Australia */}
            <path d="M 78,58 L 76,60 L 76,65 L 78,68 L 82,68 L 88,66 L 90,62 L 90,60 L 88,58 Z" />
          </g>

          {/* Grid lines for reference */}
          <g stroke="#e2e8f0" strokeWidth="0.1" opacity="0.3">
            {/* Horizontal lines */}
            {[20, 30, 40, 50, 60, 70].map((y) => (
              <line key={`h-${y}`} x1="0" y1={y} x2="100" y2={y} />
            ))}
            {/* Vertical lines */}
            {[20, 40, 60, 80].map((x) => (
              <line key={`v-${x}`} x1={x} y1="0" x2={x} y2="100" />
            ))}
          </g>

          {/* Region markers */}
          {markers.map((marker) => {
            const size = getMarkerSize(marker);
            const color = getMarkerColor(marker);
            const isSelected =
              selectedMarker?.region === marker.region &&
              selectedMarker?.cloud === marker.cloud;

            return (
              <g key={`${marker.cloud}-${marker.region}`}>
                {/* Outer ring for selected marker */}
                {isSelected && (
                  <circle
                    cx={marker.x}
                    cy={marker.y}
                    r={size / 100 + 2}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="0.3"
                    className="animate-pulse"
                  />
                )}

                {/* Main marker circle */}
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r={size / 100}
                  fill={color}
                  stroke="white"
                  strokeWidth="0.2"
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => onMarkerSelect(marker)}
                  style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
                >
                  <title>
                    {marker.region} ({marker.cloud.toUpperCase()})
                    {'\n'}
                    {marker.databases.length} database{marker.databases.length !== 1 ? 's' : ''}
                    {marker.criticalCount > 0 && `\n${marker.criticalCount} critical`}
                    {marker.warningCount > 0 && `\n${marker.warningCount} warning`}
                  </title>
                </circle>

                {/* Badge for problem count */}
                {(marker.criticalCount > 0 || marker.warningCount > 0) && (
                  <g>
                    <circle
                      cx={marker.x + (size / 100) * 0.7}
                      cy={marker.y - (size / 100) * 0.7}
                      r="1.2"
                      fill={marker.criticalCount > 0 ? '#dc2626' : '#eab308'}
                      stroke="white"
                      strokeWidth="0.15"
                    />
                    <text
                      x={marker.x + (size / 100) * 0.7}
                      y={marker.y - (size / 100) * 0.7}
                      fontSize="1.2"
                      fill="white"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontWeight="bold"
                    >
                      {marker.criticalCount || marker.warningCount}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-green-500" />
          <span className="text-muted-foreground">Healthy</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-yellow-500" />
          <span className="text-muted-foreground">Warning</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-red-500" />
          <span className="text-muted-foreground">Critical</span>
        </div>
        <div className="ml-auto text-muted-foreground">
          Marker size = Database count
        </div>
      </div>
    </div>
  );
}

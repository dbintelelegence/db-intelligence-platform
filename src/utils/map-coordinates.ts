import type { Database, CloudProvider } from '@/types';

export interface RegionMarker {
  region: string;
  cloud: CloudProvider;
  databases: Database[];
  x: number; // Percentage position (0-100)
  y: number; // Percentage position (0-100)
  criticalCount: number;
  warningCount: number;
  healthyCount: number;
}

// Approximate coordinates for common AWS/GCP/Azure regions
// Using percentage-based positioning on a simplified world map (0-100 for both x and y)
const REGION_COORDINATES: Record<string, { x: number; y: number }> = {
  // US regions
  'us-east-1': { x: 22, y: 35 },
  'us-east-2': { x: 23, y: 37 },
  'us-west-1': { x: 15, y: 36 },
  'us-west-2': { x: 14, y: 33 },
  'us-central-1': { x: 20, y: 38 }, // GCP
  'us-central1': { x: 20, y: 38 }, // GCP
  'us-south-1': { x: 21, y: 42 },
  'centralus': { x: 20, y: 37 }, // Azure
  'eastus': { x: 22, y: 36 }, // Azure
  'eastus2': { x: 23, y: 37 }, // Azure
  'westus': { x: 15, y: 35 }, // Azure
  'westus2': { x: 14, y: 34 }, // Azure
  'southcentralus': { x: 21, y: 41 }, // Azure

  // Europe regions
  'eu-west-1': { x: 48, y: 28 }, // Ireland
  'eu-west-2': { x: 48, y: 27 }, // London
  'eu-west-3': { x: 50, y: 30 }, // Paris
  'eu-central-1': { x: 52, y: 27 }, // Frankfurt
  'eu-north-1': { x: 53, y: 20 }, // Stockholm
  'europe-west1': { x: 50, y: 29 }, // GCP Belgium
  'europe-west2': { x: 48, y: 27 }, // GCP London
  'europe-west3': { x: 52, y: 27 }, // GCP Frankfurt
  'northeurope': { x: 53, y: 24 }, // Azure Ireland
  'westeurope': { x: 51, y: 28 }, // Azure Netherlands

  // Asia-Pacific regions
  'ap-south-1': { x: 68, y: 45 }, // Mumbai
  'ap-southeast-1': { x: 73, y: 48 }, // Singapore
  'ap-southeast-2': { x: 85, y: 62 }, // Sydney
  'ap-northeast-1': { x: 80, y: 35 }, // Tokyo
  'ap-northeast-2': { x: 79, y: 36 }, // Seoul
  'ap-east-1': { x: 76, y: 42 }, // Hong Kong
  'asia-east1': { x: 77, y: 43 }, // GCP Taiwan
  'asia-northeast1': { x: 80, y: 35 }, // GCP Tokyo
  'asia-south1': { x: 68, y: 45 }, // GCP Mumbai
  'asia-southeast1': { x: 73, y: 48 }, // GCP Singapore
  'eastasia': { x: 77, y: 42 }, // Azure Hong Kong
  'southeastasia': { x: 73, y: 48 }, // Azure Singapore
  'japaneast': { x: 80, y: 35 }, // Azure Tokyo

  // South America
  'sa-east-1': { x: 32, y: 60 }, // São Paulo
  'southamerica-east1': { x: 32, y: 60 }, // GCP São Paulo
  'brazilsouth': { x: 32, y: 60 }, // Azure Brazil

  // Canada
  'ca-central-1': { x: 20, y: 30 }, // Montreal
  'canadacentral': { x: 20, y: 30 }, // Azure Canada

  // Middle East
  'me-south-1': { x: 60, y: 42 }, // Bahrain
  'uaenorth': { x: 62, y: 43 }, // Azure UAE

  // Africa
  'af-south-1': { x: 54, y: 62 }, // Cape Town
  'southafricanorth': { x: 54, y: 60 }, // Azure South Africa
};

/**
 * Gets coordinate for a region, with fallback to default if not found
 */
function getRegionCoordinate(region: string): { x: number; y: number } {
  return (
    REGION_COORDINATES[region.toLowerCase()] || {
      x: 50,
      y: 40,
    }
  ); // Default to center
}

/**
 * Groups databases into region markers for map display
 */
export function createRegionMarkers(databases: Database[]): RegionMarker[] {
  const regionMap = new Map<string, Database[]>();

  // Group databases by cloud+region key
  databases.forEach((db) => {
    const key = `${db.cloud}-${db.region}`;
    if (!regionMap.has(key)) {
      regionMap.set(key, []);
    }
    regionMap.get(key)!.push(db);
  });

  // Create markers
  const markers: RegionMarker[] = [];

  regionMap.forEach((dbs) => {
    const firstDb = dbs[0];
    const coord = getRegionCoordinate(firstDb.region);

    markers.push({
      region: firstDb.region,
      cloud: firstDb.cloud,
      databases: dbs,
      x: coord.x,
      y: coord.y,
      criticalCount: dbs.filter((db) => db.healthStatus === 'critical').length,
      warningCount: dbs.filter((db) => db.healthStatus === 'warning').length,
      healthyCount: dbs.filter(
        (db) => db.healthStatus === 'excellent' || db.healthStatus === 'good'
      ).length,
    });
  });

  return markers;
}

/**
 * Gets color for marker based on health status
 */
export function getMarkerColor(marker: RegionMarker): string {
  if (marker.criticalCount > 0) {
    return '#ef4444'; // red-500
  }
  if (marker.warningCount > 0) {
    return '#eab308'; // yellow-500
  }
  return '#22c55e'; // green-500
}

/**
 * Gets marker size based on database count
 */
export function getMarkerSize(marker: RegionMarker): number {
  const count = marker.databases.length;
  if (count <= 2) return 16;
  if (count <= 5) return 20;
  if (count <= 10) return 24;
  return 28;
}

/**
 * Formats currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

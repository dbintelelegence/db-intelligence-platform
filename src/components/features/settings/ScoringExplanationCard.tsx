import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Info } from 'lucide-react';

export function ScoringExplanationCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5 text-blue-500" />
          How Health Scoring Works
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">1. Metric Evaluation</h4>
            <p>
              Each database has 6 metrics: CPU, Memory, Storage, Connection Ratio, Latency, and Throughput.
              Each metric is evaluated against threshold bands to produce a <strong>sub-score</strong> (0-100).
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">2. Utilization Check</h4>
            <p>
              For CPU, Memory, Storage, and Connections, <strong>underutilization</strong> is also penalized.
              Resources running idle or far below capacity signal over-provisioning and wasted cost.
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">3. Weighted Combination</h4>
            <p>
              Sub-scores are combined using <strong>per-database-type weights</strong> that sum to 1.0.
              Different database types emphasize different metrics (e.g., Redis prioritizes memory, DynamoDB prioritizes throughput).
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">4. Health Score</h4>
            <p>
              The weighted sum produces a final score (0-100), mapped to a status:
              <span className="text-emerald-600 font-medium"> Excellent</span> (&ge;95),
              <span className="text-green-500 font-medium"> Good</span> (&ge;85),
              <span className="text-amber-500 font-medium"> Warning</span> (&ge;70),
              <span className="text-red-500 font-medium"> Critical</span> (&lt;70).
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

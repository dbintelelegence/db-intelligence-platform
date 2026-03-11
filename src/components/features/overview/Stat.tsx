interface StatProps {
  label: string;
  value: string | number;
}

export function Stat({ label, value }: StatProps) {
  return (
    <div>
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

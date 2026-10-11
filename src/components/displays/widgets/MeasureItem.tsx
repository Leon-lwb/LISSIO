/// 测量值网格项 (Vpp/Vmin/Vmax/Vavg/Vrms/Freq)
export function MeasureItem({
  label,
  value,
  unit,
  formatter,
}: {
  label: string;
  value: number;
  unit: string;
  formatter?: (v: number) => string;
}) {
  return (
    <div className="flex flex-col py-0.5 px-1 bg-bg-input rounded-sm border-l-2 border-blue">
      <span className="text-[9px] text-text-secondary uppercase tracking-[0.5px]">{label}</span>
      <span className="font-mono text-xs text-text-bright inline-flex items-baseline gap-0.5">
        {formatter ? formatter(value) : value.toFixed(3)}
        <span className="text-[9px] text-text-secondary ml-px">{unit}</span>
      </span>
    </div>
  );
}


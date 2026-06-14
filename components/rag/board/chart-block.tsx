'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';

// Renders a data chart from an LLM-emitted spec (the model emits DATA, not a
// drawing — far more reliable than hand-drawn SVG). Spec shape:
//   { "type": "bar"|"line"|"area"|"pie", "title"?: string, "xKey"?: string,
//     "series"?: [{ "key": string, "label"?: string, "color"?: string }],
//     "data": [ { "<xKey>": "...", "<series.key>": number, ... } ] }
// If `series` is omitted, every numeric key (other than xKey) becomes a series.

const PALETTE = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#0ea5e9',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6'
];

type Series = { key: string; label?: string; color?: string };
interface Spec {
  type?: string;
  title?: string;
  xKey?: string;
  series?: Series[];
  data?: Record<string, unknown>[];
}

export function ChartBlock({ code }: { code: string }) {
  let spec: Spec;
  try {
    spec = JSON.parse(code);
  } catch {
    return <pre className="overflow-auto rounded-lg bg-black/[0.05] p-2 text-[12px]">{code}</pre>;
  }
  const data = Array.isArray(spec.data) ? spec.data : [];
  if (data.length === 0) {
    return <pre className="overflow-auto rounded-lg bg-black/[0.05] p-2 text-[12px]">{code}</pre>;
  }

  const xKey =
    spec.xKey ||
    ['name', 'label', 'x', 'category'].find((k) => k in data[0]) ||
    Object.keys(data[0])[0];

  const series: Series[] =
    spec.series && spec.series.length
      ? spec.series
      : Object.keys(data[0])
          .filter((k) => k !== xKey && typeof data[0][k] === 'number')
          .map((k) => ({ key: k }));

  const type = (spec.type ?? 'bar').toLowerCase();

  const body = (() => {
    if (type === 'pie') {
      const valueKey = series[0]?.key ?? 'value';
      return (
        <PieChart>
          <Tooltip />
          <Pie data={data} dataKey={valueKey} nameKey={xKey} outerRadius={90} label>
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Legend />
        </PieChart>
      );
    }
    if (type === 'line') {
      return (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          {series.length > 1 && <Legend />}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={s.color ?? PALETTE[i % PALETTE.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      );
    }
    if (type === 'area') {
      return (
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          {series.length > 1 && <Legend />}
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={s.color ?? PALETTE[i % PALETTE.length]}
              fill={s.color ?? PALETTE[i % PALETTE.length]}
              fillOpacity={0.25}
            />
          ))}
        </AreaChart>
      );
    }
    // default: bar
    return (
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        {series.length > 1 && <Legend />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label ?? s.key}
            fill={s.color ?? PALETTE[i % PALETTE.length]}
            radius={[3, 3, 0, 0]}
          />
        ))}
      </BarChart>
    );
  })();

  return (
    <figure className="my-3 rounded-xl border border-[rgb(var(--hairline)/0.16)] bg-card p-3">
      {spec.title && (
        <figcaption className="mb-2 text-[13px] font-semibold text-foreground/80">
          {spec.title}
        </figcaption>
      )}
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>{body}</ResponsiveContainer>
      </div>
    </figure>
  );
}

export default ChartBlock;

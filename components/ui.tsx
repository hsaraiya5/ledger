"use client";

export function Chips<T extends string>({ value, options, onChange, label = "Time period" }: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

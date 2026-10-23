import { useEffect, useState, type ReactNode } from 'react';

export function Check(props: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>
        {props.children}
        {props.hint && <span className="muted"> — {props.hint}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>(props: {
  /** null: nothing selected. */
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={props.value === option.value}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** One entry per line; saved when the field loses focus. */
export function LinesField(props: { value: string[]; onChange: (lines: string[]) => void; placeholder?: string; label: string }) {
  const [text, setText] = useState(props.value.join('\n'));
  useEffect(() => setText(props.value.join('\n')), [props.value]);
  return (
    <textarea
      aria-label={props.label}
      value={text}
      placeholder={props.placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() =>
        props.onChange(
          text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        )
      }
    />
  );
}

export function NumberField(props: { value: number; min: number; max: number; onChange: (value: number) => void; label: string }) {
  return (
    <input
      type="number"
      aria-label={props.label}
      min={props.min}
      max={props.max}
      value={props.value}
      onChange={(e) => {
        const value = Number(e.target.value);
        if (Number.isFinite(value) && value >= props.min && value <= props.max) props.onChange(value);
      }}
    />
  );
}

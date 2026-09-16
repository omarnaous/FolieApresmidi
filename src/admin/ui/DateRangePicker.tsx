import { PRESET_LABELS, resolveRange, toDateInput, type RangePreset, type RangeValue } from '../lib/dates';
import { Select, TextInput } from './form';

export function DateRangePicker({
  value,
  onChange,
  presets,
  label = 'Date range',
}: {
  value: RangeValue;
  onChange: (v: RangeValue) => void;
  presets: RangePreset[];
  label?: string;
}) {
  const invalid = value.preset === 'custom' && !!value.from && !!value.to && resolveRange(value) === null;
  return (
    <div className="adm-daterange">
      <Select
        label={label}
        value={value.preset}
        onChange={(e) => {
          const preset = e.target.value as RangePreset;
          if (preset !== 'custom') return onChange({ preset });
          const current = resolveRange(value) ?? resolveRange({ preset: '30d' });
          onChange({ preset, from: current ? toDateInput(current.from) : '', to: current ? toDateInput(current.to) : '' });
        }}
      >
        {presets.map((p) => (
          <option key={p} value={p}>
            {PRESET_LABELS[p]}
          </option>
        ))}
      </Select>
      {value.preset === 'custom' && (
        <>
          <TextInput label="From" type="date" value={value.from ?? ''} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <TextInput
            label="To"
            type="date"
            value={value.to ?? ''}
            min={value.from || undefined}
            error={invalid ? 'Must be on or after the start' : undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </>
      )}
    </div>
  );
}

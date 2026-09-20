import { Select, TextInput } from './form';

/** Collection handle picker; falls back to a text input if collections can't load. */
export function CollectionSelect({
  options,
  failed,
  label,
  value,
  onChange,
  error,
  emptyLabel,
}: {
  options: { id: string; handle: string; title: string }[];
  failed: boolean;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  emptyLabel: string;
}) {
  if (failed) {
    return <TextInput label={label} value={value} error={error} hint="Collection handle (collections could not be loaded)." onChange={(e) => onChange(e.target.value)} />;
  }
  const known = options.some((c) => c.handle === value);
  return (
    <Select label={label} value={value} error={error} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {value && !known && <option value={value}>{value} (not published)</option>}
      {options.map((c) => (
        <option key={c.id} value={c.handle}>
          {c.title}
        </option>
      ))}
    </Select>
  );
}

import { useId, useState, type KeyboardEvent } from 'react';
import type { FieldErrors } from '../../lib/forms';
import { clientKey, cx } from '../../lib/util';
import { Button, IconButton } from '../../ui/Button';
import { Banner } from '../../ui/feedback';
import { TextInput } from '../../ui/form';
import { IconClose, IconPlus, IconTrash } from '../../ui/icons';
import { Card } from '../../ui/layout';
import { combinationCount, isColourOption, MAX_OPTIONS, MAX_VARIANTS, type OptionDraft } from './productDraft';

export function OptionsCard({ options, errors, onChange }: { options: OptionDraft[]; errors: FieldErrors; onChange: (next: OptionDraft[]) => void }) {
  const update = (i: number, patch: Partial<OptionDraft>) => onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const count = combinationCount(options);
  const suggest = () => {
    const names = options.map((o) => o.name.trim().toLowerCase());
    return ['Size', 'Colour', 'Material'].find((n) => !names.includes(n.toLowerCase()) && !(n === 'Colour' && names.includes('color'))) ?? '';
  };

  return (
    <Card
      title="Options"
      actions={
        options.length < MAX_OPTIONS ? (
          <Button size="sm" icon={<IconPlus size={14} />} onClick={() => onChange([...options, { key: clientKey('o'), name: suggest(), values: [] }])}>
            Add option
          </Button>
        ) : undefined
      }
    >
      {options.length === 0 ? (
        <p className="adm-muted">This product has a single variant. Add options such as size or colour to sell it in several variants.</p>
      ) : (
        <ol className="adm-options">
          {options.map((o, i) => (
            <li key={o.key} className="adm-option">
              <div className="adm-option__head">
                <TextInput
                  label={`Option ${i + 1} name`}
                  value={o.name}
                  list="adm-option-names"
                  maxLength={40}
                  error={errors[`options.${i}.name`]}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <IconButton label={`Remove option ${o.name || i + 1}`} tone="danger" onClick={() => onChange(options.filter((_, j) => j !== i))}>
                  <IconTrash />
                </IconButton>
              </div>
              <OptionValues option={o} error={errors[`options.${i}.values`] ?? Object.entries(errors).find(([k]) => k.startsWith(`options.${i}.values.`))?.[1]} onChange={(values) => update(i, { values })} />
            </li>
          ))}
        </ol>
      )}
      {count > MAX_VARIANTS && (
        <Banner tone="warning" title={`${count.toLocaleString()} combinations`}>
          <p>A product can have at most {MAX_VARIANTS} variants. Remove some values to continue.</p>
        </Banner>
      )}
      <datalist id="adm-option-names">
        <option value="Size" />
        <option value="Colour" />
        <option value="Material" />
      </datalist>
    </Card>
  );
}

function OptionValues({ option, error, onChange }: { option: OptionDraft; error?: string; onChange: (values: OptionDraft['values']) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const colour = isColourOption(option.name);

  const add = (raw: string) => {
    const next = [...option.values];
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((value) => {
        if (next.length < 100 && !next.some((v) => v.value.toLowerCase() === value.toLowerCase())) next.push({ value: value.slice(0, 80), swatch: null });
      });
    if (next.length !== option.values.length) onChange(next);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && !text && option.values.length) {
      onChange(option.values.slice(0, -1));
    }
  };

  return (
    <div className={cx('adm-field', error && 'adm-field--error')}>
      <label htmlFor={id} className="adm-field__label">
        Values
      </label>
      <div className={cx('adm-tags', error && 'adm-tags--error')}>
        {option.values.map((v) => (
          <span key={v.value} className="adm-chip">
            {colour && (
              <input
                type="color"
                className={cx('adm-swatch', !v.swatch && 'adm-swatch--unset')}
                value={v.swatch ?? '#e3d7c6'}
                aria-label={`Swatch colour for ${v.value}${v.swatch ? ` (${v.swatch})` : ' (not set)'}`}
                onChange={(e) => onChange(option.values.map((x) => (x.value === v.value ? { ...x, swatch: e.target.value } : x)))}
              />
            )}
            {v.value}
            <button type="button" className="adm-chip__x" aria-label={`Remove ${v.value}`} onClick={() => onChange(option.values.filter((x) => x.value !== v.value))}>
              <IconClose size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          className="adm-tags__input"
          value={text}
          placeholder={option.values.length ? 'Add value' : 'Small, Medium, Large'}
          aria-describedby={`${id}-hint`}
          onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={onKey}
          onBlur={() => text && add(text)}
        />
      </div>
      <p id={`${id}-hint`} className="adm-field__hint">
        Press Enter or comma after each value.{colour ? ' Click a swatch to set the colour shown in the store.' : ''}
      </p>
      {error && <p className="adm-field__error">{error}</p>}
    </div>
  );
}

import { Fragment, useState } from 'react';
import { imageSrc, type MediaDTO } from '../../lib/contract';
import type { FieldErrors } from '../../lib/forms';
import { cx, plural } from '../../lib/util';
import { Button, IconButton } from '../../ui/Button';
import { Checkbox, MoneyInput, NumberInput, Select, TextInput } from '../../ui/form';
import { IconChevronDown, IconChevronUp, IconHistory } from '../../ui/icons';
import { Card } from '../../ui/layout';
import { Thumb } from '../../ui/Table';
import { InventoryHistory } from './InventoryHistory';
import { variantTitle, type VariantDraft } from './productDraft';

const DETAIL_FIELDS = ['weightGrams', 'costPrice', 'imageId', 'inventoryPolicy', 'requiresShipping', 'taxable', 'inventoryTracked'];

export function VariantsCard({
  variants,
  media,
  currency,
  errors,
  onChange,
}: {
  variants: VariantDraft[];
  media: MediaDTO[];
  currency: string;
  errors: FieldErrors;
  onChange: (next: VariantDraft[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState<number | null>(null);
  const [bulkQty, setBulkQty] = useState<number | null>(null);
  const [history, setHistory] = useState<{ id: string; title: string } | null>(null);

  const multi = variants.length > 1 || variants.some((v) => v.options.length > 0);
  const liveSelected = variants.filter((v) => selected.has(v.key));
  const allSelected = multi && liveSelected.length === variants.length;
  const update = (key: string, patch: Partial<VariantDraft>) => onChange(variants.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  const applyBulk = (patch: Partial<VariantDraft>) => onChange(variants.map((v) => (selected.has(v.key) ? { ...v, ...patch } : v)));
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const totalOnHand = variants.reduce((n, v) => n + (v.inventoryOnHand ?? 0), 0);
  const cols = multi ? 7 : 6;

  return (
    <Card title={multi ? `Variants · ${variants.length}` : 'Pricing & inventory'} flush actions={<span className="adm-muted adm-small">{plural(totalOnHand, 'unit')} on hand</span>}>
      {errors.variants && <p className="adm-field__error adm-card__pad">{errors.variants}</p>}

      {multi && liveSelected.length > 0 && (
        <div className="adm-bulkbar" role="region" aria-label="Bulk edit variants">
          <span className="adm-strong">{liveSelected.length} selected</span>
          <div className="adm-bulkbar__group">
            <MoneyInput label="Set price" currency={currency} value={bulkPrice} onChange={setBulkPrice} />
            <Button size="sm" disabled={bulkPrice === null} onClick={() => applyBulk({ price: bulkPrice })}>
              Apply price
            </Button>
          </div>
          <div className="adm-bulkbar__group">
            <NumberInput label="Set quantity" min={0} value={bulkQty} onChange={setBulkQty} />
            <Button size="sm" disabled={bulkQty === null || bulkQty < 0} onClick={() => applyBulk({ inventoryOnHand: bulkQty })}>
              Apply quantity
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="adm-table-wrap" role="region" aria-label="Variants" tabIndex={0}>
        <table className="adm-table adm-table--edit">
          <caption className="adm-sr">Variants</caption>
          <thead>
            <tr>
              {multi && (
                <th scope="col" className="adm-table__check">
                  <input
                    type="checkbox"
                    aria-label="Select all variants"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = liveSelected.length > 0 && !allSelected;
                    }}
                    onChange={(e) => setSelected(e.target.checked ? new Set(variants.map((v) => v.key)) : new Set())}
                  />
                </th>
              )}
              <th scope="col">Variant</th>
              <th scope="col" style={{ minWidth: '8.5rem' }}>
                Price
              </th>
              <th scope="col" style={{ minWidth: '8.5rem' }}>
                Compare-at
              </th>
              <th scope="col" style={{ minWidth: '8rem' }}>
                SKU
              </th>
              <th scope="col" style={{ minWidth: '7.5rem' }}>
                On hand
              </th>
              <th scope="col">
                <span className="adm-sr">More</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v, i) => {
              const e = (field: string) => errors[`variants.${i}.${field}`];
              const title = variantTitle(v.options);
              const detailError = DETAIL_FIELDS.some((f) => e(f));
              const open = expanded.has(v.key) || detailError;
              const detailsId = `adm-variant-${v.key}`;
              const image = media.find((m) => m.id === v.imageId);
              const vid = v.id;
              const available = (v.inventoryOnHand ?? 0) - v.inventoryReserved;
              return (
                <Fragment key={v.key}>
                  <tr className={cx(selected.has(v.key) && 'adm-table__row--on')}>
                    {multi && (
                      <td className="adm-table__check">
                        <input type="checkbox" aria-label={`Select ${title}`} checked={selected.has(v.key)} onChange={() => setSelected((s) => toggle(s, v.key))} />
                      </td>
                    )}
                    <td>
                      <div className="adm-variantcell">
                        <Thumb src={image ? imageSrc(image, 320) : null} size={32} />
                        <span className="adm-cellstack">
                          <span className="adm-strong">{title}</span>
                          {!vid && <span className="adm-muted adm-small">New</span>}
                          {e('options') && <span className="adm-field__error">{e('options')}</span>}
                        </span>
                      </div>
                    </td>
                    <td>
                      <MoneyInput label={`Price for ${title}`} labelHidden currency={currency} value={v.price} error={e('price')} onChange={(price) => update(v.key, { price })} />
                    </td>
                    <td>
                      <MoneyInput
                        label={`Compare-at price for ${title}`}
                        labelHidden
                        currency={currency}
                        value={v.compareAtPrice}
                        error={e('compareAtPrice')}
                        onChange={(compareAtPrice) => update(v.key, { compareAtPrice })}
                      />
                    </td>
                    <td>
                      <TextInput label={`SKU for ${title}`} labelHidden value={v.sku} maxLength={64} error={e('sku')} onChange={(ev) => update(v.key, { sku: ev.target.value })} />
                    </td>
                    <td>
                      <NumberInput
                        label={`On-hand quantity for ${title}`}
                        labelHidden
                        min={0}
                        value={v.inventoryOnHand}
                        error={e('inventoryOnHand')}
                        onChange={(inventoryOnHand) => update(v.key, { inventoryOnHand })}
                      />
                      {v.inventoryReserved > 0 && (
                        <span className="adm-muted adm-small adm-nowrap">
                          {v.inventoryReserved} reserved · {available} available
                        </span>
                      )}
                    </td>
                    <td className="adm-nowrap">
                      <IconButton
                        label={`${open ? 'Hide' : 'Show'} more settings for ${title}`}
                        aria-expanded={open}
                        aria-controls={open ? detailsId : undefined}
                        onClick={() => setExpanded((s) => toggle(s, v.key))}
                      >
                        {open ? <IconChevronUp /> : <IconChevronDown />}
                      </IconButton>
                      {vid && (
                        <IconButton label={`Inventory history for ${title}`} onClick={() => setHistory({ id: vid, title })}>
                          <IconHistory />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr id={detailsId} className="adm-table__detail">
                      <td colSpan={cols}>
                        <div className="adm-grid adm-grid--4">
                          <NumberInput label="Weight" suffix="g" min={0} value={v.weightGrams} error={e('weightGrams')} onChange={(weightGrams) => update(v.key, { weightGrams })} />
                          <MoneyInput label="Cost per item" optional currency={currency} value={v.costPrice} error={e('costPrice')} onChange={(costPrice) => update(v.key, { costPrice })} hint="Customers won't see this." />
                          <Select label="Image" value={v.imageId ?? ''} error={e('imageId')} onChange={(ev) => update(v.key, { imageId: ev.target.value || null })}>
                            <option value="">No image</option>
                            {media.map((m, idx) => (
                              <option key={m.id} value={m.id}>
                                {`Image ${idx + 1}${m.alt ? ` — ${m.alt.slice(0, 40)}` : ''}`}
                              </option>
                            ))}
                          </Select>
                          <div className="adm-stack-sm">
                            <Checkbox label="Track inventory" checked={v.inventoryTracked} onChange={(inventoryTracked) => update(v.key, { inventoryTracked })} />
                            <Checkbox
                              label="Continue selling when out of stock"
                              checked={v.inventoryPolicy === 'continue'}
                              disabled={!v.inventoryTracked}
                              onChange={(on) => update(v.key, { inventoryPolicy: on ? 'continue' : 'deny' })}
                            />
                            <Checkbox label="Requires shipping" checked={v.requiresShipping} onChange={(requiresShipping) => update(v.key, { requiresShipping })} />
                            <Checkbox label="Charge tax" checked={v.taxable} onChange={(taxable) => update(v.key, { taxable })} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <InventoryHistory variant={history} onClose={() => setHistory(null)} />
    </Card>
  );
}

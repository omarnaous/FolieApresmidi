/**
 * Every field the courier needs, in the order you would say them out loud.
 * Used by the checkout.
 */
import type { AddressDTO, StoreDTO } from '../../shared/api';
import { AddressInput } from '../../shared/api';
import { zodFields, type FieldErrors } from '../lib/errors';
import { SelectField, TextField } from './fields';

export interface AddressValues {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  countryCode: string;
  notes: string;
}

export type AddressField = keyof AddressValues;

export const ADDRESS_ORDER: AddressField[] = ['name', 'phone', 'line1', 'line2', 'city', 'region', 'countryCode', 'notes'];

export const defaultCountry = (store: StoreDTO | null | undefined) => store?.shipsTo[0]?.code ?? 'LB';

export const addressValues = (a: AddressDTO | null | undefined, country: string): AddressValues => ({
  name: a?.name ?? '',
  phone: a?.phone ?? '',
  line1: a?.line1 ?? '',
  line2: a?.line2 ?? '',
  city: a?.city ?? '',
  region: a?.region ?? '',
  countryCode: a?.countryCode ?? country,
  notes: a?.notes ?? '',
});

export const toAddress = (v: AddressValues): AddressDTO => ({
  name: v.name.trim(),
  phone: v.phone.trim(),
  line1: v.line1.trim(),
  line2: v.line2.trim(),
  city: v.city.trim(),
  region: v.region.trim() || null,
  postalCode: null,
  countryCode: v.countryCode,
  notes: v.notes.trim() || null,
});

/**
 * The contract's own rules, plus the building line — optional to the
 * database, but the courier cannot find a flat without it.
 */
export function checkAddress(v: AddressValues): FieldErrors {
  const parsed = AddressInput.safeParse(toAddress(v));
  const errors = parsed.success ? {} : zodFields(parsed.error);
  if (!v.line2.trim() && !errors.line2) errors.line2 = 'Required';
  return errors;
}

interface Props {
  idPrefix: string;
  values: AddressValues;
  errors: FieldErrors;
  onChange: (field: AddressField, value: string) => void;
  countries: StoreDTO['shipsTo'];
  /** the checkout asks for the phone once, with the email */
  withPhone?: boolean;
}

export function AddressFields({ idPrefix, values, errors, onChange, countries, withPhone = false }: Props) {
  const id = (f: AddressField) => `${idPrefix}-${f}`;
  const input = (f: AddressField) => ({
    id: id(f),
    value: values[f],
    error: errors[f],
    onChange: (e: { target: { value: string } }) => onChange(f, e.target.value),
  });

  // a saved address in a country we no longer ship to still has to show its country
  const options = countries.some((c) => c.code === values.countryCode) || !values.countryCode
    ? countries
    : [...countries, { code: values.countryCode, name: values.countryCode }];

  return (
    <div className="co-fields">
      <TextField {...input('name')} label="Full name" autoComplete="name" placeholder="Your full name" />
      {withPhone && <TextField {...input('phone')} label="Phone" type="tel" autoComplete="tel" placeholder="+961 …" />}
      <TextField {...input('line1')} label="Area / street" autoComplete="address-line1" placeholder="Mar Mikhaël, Armenia St." />
      <TextField {...input('line2')} label="Building, floor" autoComplete="address-line2" placeholder="Building and floor" />
      <TextField {...input('city')} label="City" autoComplete="address-level2" placeholder="Beirut" />
      <TextField {...input('region')} label="Region" optional autoComplete="address-level1" placeholder="Optional" />
      <SelectField
        {...input('countryCode')}
        label="Country"
        autoComplete="country"
        options={options.map((c) => ({ value: c.code, label: c.name }))}
      />
      <TextField {...input('notes')} label="Notes for the courier" optional wide placeholder="Optional" />
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import type { SavedAddressDTO } from '../../shared/api';
import { messageFor } from '../lib/errors';
import { useAddresses, useDeleteAddress, useSaveAddress, useStore } from '../lib/queries';
import {
  ADDRESS_ORDER, AddressFields, addressValues, checkAddress, defaultCountry, toAddress, type AddressField,
} from '../ui/AddressFields';
import { AddressLines } from '../ui/AddressLines';
import { CheckField, FormAlert } from '../ui/fields';
import { LoadError, Loading } from '../ui/States';
import { useFormErrors } from '../ui/useFormErrors';

const idFor = (field: string) => `acct-address-${field}`;

function AddressForm({ initial, onDone }: { initial: SavedAddressDTO | null; onDone: () => void }) {
  const { data: store } = useStore();
  const save = useSaveAddress();
  const [values, setValues] = useState(() => addressValues(initial, defaultCountry(store)));
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const form = useFormErrors(ADDRESS_ORDER, idFor);

  const set = (field: AddressField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    form.clear(field);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    const found = checkAddress(values);
    if (Object.keys(found).length) { form.show(found); return; }
    form.clear();
    save.mutate(
      { id: initial?.id ?? null, input: { ...toAddress(values), isDefault } },
      { onSuccess: onDone, onError: (err) => form.fail(err) },
    );
  };

  return (
    <form className="acct-form" onSubmit={submit} noValidate>
      <h2 className="display d-sm">{initial ? 'Edit the address' : 'A new address'}</h2>
      <AddressFields
        idPrefix="acct-address"
        values={values}
        errors={form.errors}
        onChange={set}
        countries={store?.shipsTo ?? []}
        withPhone
      />
      <CheckField id={idFor('default')} label="Use as my default address" checked={isDefault} onChange={setIsDefault} />
      <FormAlert message={form.alert} />
      <div className="co-actions">
        <button type="submit" className="btn solid" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save address'}
        </button>
        <button type="button" className="label link-u" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export function Addresses() {
  const list = useAddresses();
  const remove = useDeleteAddress();
  const [editing, setEditing] = useState<SavedAddressDTO | 'new' | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  if (editing) return <AddressForm initial={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />;
  if (list.isPending) return <Loading label="Finding your addresses…" />;
  if (list.isError) {
    return <LoadError title="Your addresses did not load." message={messageFor(list.error)} onRetry={() => list.refetch()} />;
  }

  const items = list.data.items;

  return (
    <>
      {items.length === 0 ? (
        <div className="acct-state">
          <span className="display d-sm">No addresses saved.</span>
          <span className="label muted">Save one and the checkout fills itself in.</span>
        </div>
      ) : (
        <ul className="acct-cards">
          {items.map((a) => (
            <li className="acct-card" key={a.id}>
              {a.isDefault && <span className="label muted">Default</span>}
              <AddressLines address={a} />
              <div className="acct-card-actions" aria-live="polite">
                {confirming === a.id ? (
                  <>
                    <span className="label">Delete this address?</span>
                    <button
                      className="label link-u"
                      onClick={() => remove.mutate(a.id, { onSuccess: () => setConfirming(null) })}
                      disabled={remove.isPending}
                    >
                      {remove.isPending ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button className="label link-u" onClick={() => { setConfirming(null); remove.reset(); }}>Keep it</button>
                  </>
                ) : (
                  <>
                    <button className="label link-u" onClick={() => setEditing(a)}>Edit</button>
                    <button className="label link-u" onClick={() => setConfirming(a.id)}>Delete</button>
                  </>
                )}
              </div>
              {confirming === a.id && remove.isError && (
                <span className="co-err label" role="alert">{messageFor(remove.error)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="co-actions">
        <button className="btn" onClick={() => setEditing('new')}>Add an address</button>
      </div>
    </>
  );
}

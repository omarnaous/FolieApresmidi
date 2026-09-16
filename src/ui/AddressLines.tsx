import type { AddressDTO } from '../../shared/api';
import { useStore } from '../lib/queries';

/** An address set the way it goes on a parcel. */
export function AddressLines({ address }: { address: AddressDTO }) {
  const { data: store } = useStore();
  const country = store?.shipsTo.find((c) => c.code === address.countryCode)?.name ?? address.countryCode;
  return (
    <address className="acct-address">
      <span>{address.name}</span>
      <span>{[address.line1, address.line2].filter(Boolean).join(', ')}</span>
      <span>{[address.city, address.region, country].filter(Boolean).join(', ')}</span>
      <span>{address.phone}</span>
      {address.notes && <span className="muted">{address.notes}</span>}
    </address>
  );
}

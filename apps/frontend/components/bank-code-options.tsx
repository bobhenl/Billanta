import { BANKS } from '@/lib/bank-account-input';

/** Suggestions for a bank code input (`list={id}`): the code with the bank's name. */
export function BankCodeOptions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {BANKS.map((b) => (
        <option key={b.code} value={b.code} label={`${b.name} (${b.country})`} />
      ))}
    </datalist>
  );
}

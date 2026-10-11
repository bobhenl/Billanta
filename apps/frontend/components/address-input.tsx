'use client';

import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { MapPin } from 'lucide-react';
import { searchAddresses, type AddressSuggestion } from '@/app/[locale]/(dashboard)/contacts/actions';
import { cn } from '@/lib/utils';

/**
 * Street input that suggests addresses as you type, e.g. "Jankovcova 15" →
 * street, city and PSČ in one pick. CZ uses the official register (RÚIAN via
 * ARES), other countries OpenStreetMap; an unknown country code is a plain input.
 */
export function AddressInput({
  value,
  onChange,
  onPick,
  country = 'CZ',
  className,
  ...rest
}: {
  value: string;
  onChange: (street: string) => void;
  onPick: (address: AddressSuggestion) => void;
  country?: string | null;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef(false);
  const listId = useId();
  const cc = (country || 'CZ').trim().toUpperCase();
  const enabled = /^[A-Z]{2}$/.test(cc);

  useEffect(() => {
    const q = value.trim();
    if (!enabled || !typed.current || q.length < 3) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchAddresses(q, cc);
      if (!cancelled) {
        setItems(found);
        setActive(-1);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, enabled, cc]);

  const pick = (a: AddressSuggestion) => {
    typed.current = false;
    setItems([]);
    setOpen(false);
    onPick(a);
  };
  const shown = open && items.length > 0;

  return (
    <div className="relative">
      <input
        {...rest}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        className={className}
        onChange={(e) => {
          typed.current = true;
          setOpen(true);
          onChange(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!shown) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)));
          } else if (e.key === 'Enter' && items[active]) {
            e.preventDefault();
            pick(items[active]!);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {shown && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-card py-1 shadow-lg">
          {items.map((a, i) => (
            <li key={`${a.label}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(a)}
                className={cn('flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent', i === active && 'bg-accent')}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block font-medium">{a.street}</span>
                  <span className="block text-xs text-muted-foreground">
                    {a.postalCode} {a.city}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {cc !== 'CZ' && (
            <li role="presentation" className="px-3 pb-1 pt-1.5 text-right text-[10px] text-muted-foreground">
              © OpenStreetMap
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

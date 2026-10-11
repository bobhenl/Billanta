import type { DocumentType } from '../new/types';

/**
 * Built-in starter templates for the gallery. Texts (name, description, item
 * descriptions) live in `templates.presets.<key>` so they follow the UI
 * language; numbers are just sensible starting values to overwrite.
 */
export interface TemplatePreset {
  key: string;
  icon: 'clock' | 'repeat' | 'package' | 'wallet' | 'file' | 'home';
  documentType: DocumentType;
  dueInDays: number;
  items: { quantity: number; unit: string; unitPrice: number; vatRate: number }[];
}

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  { key: 'hourly', icon: 'clock', documentType: 'invoice', dueInDays: 14, items: [{ quantity: 10, unit: 'hod', unitPrice: 1200, vatRate: 21 }] },
  { key: 'retainer', icon: 'repeat', documentType: 'invoice', dueInDays: 14, items: [{ quantity: 1, unit: 'měs', unitPrice: 15000, vatRate: 21 }] },
  {
    key: 'goods',
    icon: 'package',
    documentType: 'invoice',
    dueInDays: 14,
    items: [
      { quantity: 1, unit: 'ks', unitPrice: 0, vatRate: 21 },
      { quantity: 1, unit: 'ks', unitPrice: 150, vatRate: 21 }
    ]
  },
  { key: 'advance', icon: 'wallet', documentType: 'proforma', dueInDays: 7, items: [{ quantity: 1, unit: '', unitPrice: 10000, vatRate: 21 }] },
  {
    key: 'quote',
    icon: 'file',
    documentType: 'quote',
    dueInDays: 30,
    items: [
      { quantity: 8, unit: 'hod', unitPrice: 1200, vatRate: 21 },
      { quantity: 16, unit: 'hod', unitPrice: 1200, vatRate: 21 },
      { quantity: 40, unit: 'hod', unitPrice: 1200, vatRate: 21 }
    ]
  },
  {
    key: 'rent',
    icon: 'home',
    documentType: 'invoice',
    dueInDays: 10,
    items: [
      { quantity: 1, unit: 'měs', unitPrice: 12000, vatRate: 0 },
      { quantity: 1, unit: 'měs', unitPrice: 2500, vatRate: 0 }
    ]
  }
];

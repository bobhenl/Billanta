import { describe, expect, it } from 'vitest';
import { DATASET_CHECKED, datasetChecked, VAT_INFO_CHECKED } from '../index.js';

describe('datasetChecked', () => {
  it('takes the monitor date only when it is later than the manual one', () => {
    expect(datasetChecked('vat_forms', { vat_forms: '2099-01-05' })).toBe('2099-01-05');
    expect(datasetChecked('vat_forms', { vat_forms: '2020-01-01' })).toBe(DATASET_CHECKED.vat_forms);
  });

  it('falls back to the manual date without a usable monitor value', () => {
    expect(datasetChecked('flat_tax')).toBe(DATASET_CHECKED.flat_tax);
    expect(datasetChecked('flat_tax', { flat_tax: null })).toBe(DATASET_CHECKED.flat_tax);
    expect(datasetChecked('flat_tax', { flat_tax: 'not a date' })).toBe(DATASET_CHECKED.flat_tax);
  });

  it('keeps VAT_INFO_CHECKED as the vat_forms date', () => {
    expect(VAT_INFO_CHECKED).toBe(DATASET_CHECKED.vat_forms);
  });
});

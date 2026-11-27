/** GET/PUT /api/v1/tenants/me/eet (backend src/eet/eet.service.ts). */
export interface EetSettings {
  enabled: boolean;
  environment: 'playground' | 'production';
  idJednotky: string | null;
  idPokl: string | null;
  cardInPerson: boolean;
  /** Public details of the uploaded pokladní certifikát; the file and its password never come back. */
  certificate: {
    commonName: string | null;
    serialNumber: string;
    validFrom: string;
    validTo: string;
    issuer: string;
    fingerprint256: string;
  } | null;
  eicMismatch: boolean;
  pending: number;
  overdue: number;
}

export type EetRecordStatus = 'pending' | 'confirmed' | 'rejected' | 'overdue';

export interface EetRecord {
  id: string;
  invoiceId: string | null;
  kind: 'sale' | 'refund';
  environment: 'playground' | 'production';
  idPokl: string;
  poradCis: string;
  datTrzby: string;
  celkTrzba: string;
  status: EetRecordStatus;
  pok: string | null;
  test: boolean | null;
  attempts: number;
  lastError: string | null;
  warnings: { code: number; text: string }[];
  createdAt: string;
}

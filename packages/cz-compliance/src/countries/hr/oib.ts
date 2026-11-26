/**
 * Croatian OIB (osobni identifikacijski broj): 11 digits, the last one an
 * ISO 7064 MOD 11,10 check digit. The VAT ID is `HR` + OIB.
 * Source: Zakon o osobnom identifikacijskom broju (NN 60/08) and the
 * Porezna uprava OIB pages (https://www.porezna-uprava.hr/HR_OIB/Stranice/default.aspx).
 */
export function normalizeOib(value: string): string {
  return value.replace(/[\s.-]/g, '').toUpperCase().replace(/^HR/, '');
}

export function isValidOib(value: string): boolean {
  const v = normalizeOib(value);
  if (!/^\d{11}$/.test(v)) return false;
  let a = 10;
  for (let i = 0; i < 10; i++) {
    a = (a + Number(v[i])) % 10;
    if (a === 0) a = 10;
    a = (a * 2) % 11;
  }
  const check = 11 - a;
  return (check === 10 ? 0 : check) === Number(v[10]);
}

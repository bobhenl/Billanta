-- Dev-only demo data for the first company of demo@faktur.local, so every
-- screen (dashboard, lists, filters, bank matching, notifications) has
-- something to show. Re-runnable: it first removes what an earlier run
-- created (contacts with an @*.example e-mail, invoices tagged "Ukázková data (demo)" in
-- the internal note, expenses noted the same (or the older "[seed]"), the "seed-*.csv" bank import)
-- and never touches anything else — the demo account itself stays.
--
--   docker exec -i faktur-postgres-dev sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -v ON_ERROR_STOP=1' < apps/backend/drizzle/seed-dev.sql

DO $$
DECLARE
  v_user uuid;
  v_tenant uuid;
  v_import uuid;
  v_contact uuid;
  v_inv uuid;
  v_contacts uuid[];
  v_names text[] := ARRAY[
    'Alza.cz a.s.', 'Novák Design s.r.o.', 'Rohlik.cz a.s.', 'Kavárna U Mostu s.r.o.',
    'Petra Svobodová', 'TechNova GmbH', 'Studio Lumen s.r.o.', 'Stavby Horák s.r.o.',
    'Bratislava Digital s.r.o.', 'Jan Dvořák'];
  v_emails text[] := ARRAY[
    'fakturace@alza.example', 'hello@novakdesign.example', 'ap@rohlik.example', 'info@umostu.example',
    'petra@svobodova.example', 'billing@technova.example', 'studio@lumen.example', 'kancelar@horak.example',
    'office@badigital.example', 'jan@dvorak.example'];
  v_icos text[] := ARRAY['27082440', '08765432', '24222011', '05544332', NULL, NULL, '09988776', '04433221', '51234567', NULL];
  v_cities text[] := ARRAY['Praha', 'Brno', 'Praha', 'Olomouc', 'Plzeň', 'Wien', 'Praha', 'Ostrava', 'Bratislava', 'Liberec'];
  v_countries text[] := ARRAY['CZ', 'CZ', 'CZ', 'CZ', 'CZ', 'AT', 'CZ', 'CZ', 'SK', 'CZ'];
  v_items text[] := ARRAY[
    'Tvorba webových stránek', 'Grafický návrh loga', 'Konzultace – hodinová sazba', 'Správa sociálních sítí',
    'Údržba e-shopu', 'Fotografie produktů', 'SEO audit', 'Programování na míru', 'Copywriting',
    'Hosting a doména (rok)', 'Školení týmu', 'Návrh tiskovin'];
  v_units text[] := ARRAY['ks', 'ks', 'hod', 'měs', 'měs', 'ks', 'ks', 'hod', 'ks', 'ks', 'den', 'ks'];
  v_prices numeric[] := ARRAY[28000, 9500, 1200, 6500, 4500, 3500, 12000, 1450, 2800, 2400, 8000, 5600];
  v_year int;
  v_seq int;
  v_seq25 int := 0;
  v_seq26 int;
  v_issue date;
  v_due date;
  v_status invoice_status;
  v_type document_type;
  v_cur text;
  v_rate numeric;
  v_total numeric;
  v_paid timestamptz;
  v_number text;
  i int;
  k int;
  n_items int;
  pick int;
BEGIN
  SELECT u.id, m.tenant_id INTO v_user, v_tenant
  FROM users u JOIN tenant_memberships m ON m.user_id = u.id
  WHERE u.email = 'demo@faktur.local'
  ORDER BY m.created_at LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'demo@faktur.local has no company — sign in once first';
  END IF;
  PERFORM set_config('app.current_tenant_id', v_tenant::text, true);
  PERFORM setseed(0.42);

  -- ---- clean an earlier run -------------------------------------------------
  DELETE FROM bank_transactions WHERE tenant_id = v_tenant AND import_id IN
    (SELECT id FROM bank_statement_imports WHERE tenant_id = v_tenant AND filename LIKE 'seed-%');
  DELETE FROM bank_statement_imports WHERE tenant_id = v_tenant AND filename LIKE 'seed-%';
  DELETE FROM invoice_line_items WHERE tenant_id = v_tenant AND invoice_id IN
    (SELECT id FROM invoices WHERE tenant_id = v_tenant AND internal_note IN ('[seed]', 'Ukázková data (demo)'));
  DELETE FROM invoices WHERE tenant_id = v_tenant AND internal_note IN ('[seed]', 'Ukázková data (demo)');
  DELETE FROM expenses WHERE tenant_id = v_tenant AND note IN ('[seed]', 'Ukázková data (demo)');
  DELETE FROM notifications WHERE tenant_id = v_tenant AND body LIKE '%(demo)';
  DELETE FROM contacts WHERE tenant_id = v_tenant AND email LIKE '%.example';

  -- ---- contacts ---------------------------------------------------------------
  FOR i IN 1..array_length(v_names, 1) LOOP
    -- The demo already has a hand-made "Alza.cz a.s."; reuse it rather than a duplicate.
    SELECT id INTO v_contact FROM contacts WHERE tenant_id = v_tenant AND legal_name = v_names[i] LIMIT 1;
    IF v_contact IS NULL THEN
      INSERT INTO contacts (tenant_id, ico, legal_name, email, address_street, address_city, address_postal_code,
                            address_country, is_person, is_starred, is_vat_payer)
      VALUES (v_tenant, v_icos[i], v_names[i], v_emails[i], 'Hlavní ' || (10 + i * 7), v_cities[i],
              lpad((11000 + i * 1371)::text, 5, '0'), v_countries[i], v_icos[i] IS NULL AND v_countries[i] IN ('CZ', 'SK'),
              i IN (1, 2, 6), v_icos[i] IS NOT NULL)
      RETURNING id INTO v_contact;
    END IF;
    v_contacts := v_contacts || v_contact;
  END LOOP;

  -- ---- invoices: ~14 months back, most paid, recent ones open/overdue ---------
  SELECT COALESCE(max(last_number), 0) INTO v_seq26 FROM invoice_number_sequences
  WHERE tenant_id = v_tenant AND year = 2026 AND series = '';

  FOR i IN 0..41 LOOP
    v_issue := (date '2026-10-02' - (i * 10 + floor(random() * 6))::int);
    v_year := extract(year FROM v_issue);
    pick := 1 + (i * 7 + floor(random() * 3)::int) % array_length(v_names, 1);
    v_contact := v_contacts[pick];
    v_cur := CASE WHEN v_countries[pick] = 'AT' THEN 'EUR' WHEN v_countries[pick] = 'SK' THEN 'EUR'
                  WHEN i % 13 = 5 THEN 'USD' ELSE 'CZK' END;
    v_rate := CASE v_cur WHEN 'EUR' THEN 24.2 + random() * 1.2 WHEN 'USD' THEN 21.5 + random() * 2 ELSE NULL END;
    v_type := CASE WHEN i IN (4, 19) THEN 'proforma'::document_type WHEN i = 11 THEN 'credit_note'::document_type
                   WHEN i IN (2, 23) THEN 'quote'::document_type ELSE 'invoice'::document_type END;
    v_due := v_issue + 14;
    v_paid := NULL;
    v_status := CASE
      WHEN i = 0 THEN 'draft'::invoice_status
      WHEN i = 1 THEN 'pending_review'::invoice_status
      WHEN i = 15 THEN 'cancelled'::invoice_status
      WHEN v_type = 'quote' THEN 'issued'::invoice_status
      WHEN i < 6 THEN 'issued'::invoice_status                    -- recent, not due yet / just overdue
      WHEN i IN (7, 9, 13) THEN 'issued'::invoice_status          -- overdue
      ELSE 'paid'::invoice_status END;
    IF v_status = 'paid' THEN
      v_paid := v_issue + (3 + floor(random() * 20))::int;
    END IF;

    v_number := NULL;
    IF v_status NOT IN ('draft', 'pending_review') THEN
      IF v_year = 2026 THEN v_seq26 := v_seq26 + 1; v_seq := v_seq26; ELSE v_seq25 := v_seq25 + 1; v_seq := v_seq25; END IF;
      v_number := v_year || '-' || lpad(v_seq::text, 4, '0');
      IF v_type = 'proforma' THEN v_number := 'ZF' || v_number; END IF;
      IF v_type = 'credit_note' THEN v_number := 'D' || v_number; END IF;
      IF v_type = 'quote' THEN v_number := 'N' || v_number; END IF;
    END IF;

    INSERT INTO invoices (tenant_id, contact_id, invoice_number, variable_symbol, issue_date, due_date, taxable_supply_date,
                          currency, status, source, document_type, issued_by_user_id, issued_at, sent_at, paid_at,
                          cancelled_at, exchange_rate, language, internal_note, needs_attention, ai_confidence_score,
                          reminder_count, last_reminder_sent_at, public_view_count, public_first_viewed_at)
    VALUES (v_tenant, v_contact, v_number, CASE WHEN v_number IS NULL THEN NULL ELSE regexp_replace(v_number, '\D', '', 'g') END,
            v_issue, v_due, v_issue, v_cur, v_status,
            CASE WHEN i = 1 THEN 'ai_telegram'::invoice_source WHEN i % 9 = 3 THEN 'recurring'::invoice_source ELSE 'manual'::invoice_source END,
            v_type, v_user,
            CASE WHEN v_number IS NOT NULL THEN v_issue::timestamptz + interval '9 hours' END,
            CASE WHEN v_number IS NOT NULL AND i % 4 <> 3 THEN v_issue::timestamptz + interval '10 hours' END,
            v_paid,
            CASE WHEN v_status = 'cancelled' THEN v_issue::timestamptz + interval '2 days' END,
            v_rate, CASE WHEN v_cur = 'CZK' THEN 'cs' WHEN v_countries[pick] = 'SK' THEN 'sk' ELSE 'en' END,
            'Ukázková data (demo)', i = 1, CASE WHEN i = 1 THEN 0.86 END,
            CASE WHEN i IN (7, 9, 13) THEN 1 + i % 2 ELSE 0 END,
            CASE WHEN i IN (7, 9, 13) THEN now() - interval '3 days' END,
            CASE WHEN v_number IS NOT NULL AND i % 3 <> 0 THEN 1 + i % 4 ELSE 0 END,
            CASE WHEN v_number IS NOT NULL AND i % 3 <> 0 THEN v_issue::timestamptz + interval '1 day' END)
    RETURNING id INTO v_inv;

    n_items := 1 + (i % 3);
    FOR k IN 1..n_items LOOP
      pick := 1 + (i * 5 + k * 3) % array_length(v_items, 1);
      INSERT INTO invoice_line_items (tenant_id, invoice_id, description, quantity, unit_price, vat_rate, sort_order, unit, discount_percent)
      VALUES (v_tenant, v_inv, v_items[pick],
              CASE WHEN v_units[pick] = 'hod' THEN 4 + floor(random() * 30) ELSE 1 + floor(random() * 2) END,
              round((v_prices[pick] * (0.8 + random() * 0.5) / COALESCE(v_rate, 1))::numeric, 0) * CASE WHEN v_type = 'credit_note' THEN -1 ELSE 1 END,
              NULL, k, v_units[pick], CASE WHEN k = 2 AND i % 5 = 0 THEN 10 ELSE 0 END);
    END LOOP;
  END LOOP;

  INSERT INTO invoice_number_sequences (tenant_id, year, last_number, series)
  VALUES (v_tenant, 2025, v_seq25, '')
  ON CONFLICT DO NOTHING;
  UPDATE invoice_number_sequences SET last_number = greatest(last_number, v_seq25) WHERE tenant_id = v_tenant AND year = 2025 AND series = '';
  UPDATE invoice_number_sequences SET last_number = greatest(last_number, v_seq26) WHERE tenant_id = v_tenant AND year = 2026 AND series = '';

  -- ---- expenses ---------------------------------------------------------------
  FOR i IN 0..23 LOOP
    INSERT INTO expenses (tenant_id, supplier_name_raw, description, amount, vat_rate, currency, expense_date, category,
                          document_number, due_date, paid_at, note)
    VALUES (v_tenant,
            (ARRAY['Adobe Systems', 'O2 Czech Republic', 'Shell', 'Kancelář Centrum s.r.o.', 'Datart', 'Google Ireland', 'ČD a.s.', 'Meta Platforms'])[1 + i % 8],
            (ARRAY['Creative Cloud – předplatné', 'Mobilní tarif', 'Pohonné hmoty', 'Nájem coworkingu', 'Monitor 27"', 'Google Workspace', 'Jízdenka Praha–Brno', 'Reklama na Facebooku'])[1 + i % 8],
            round(((ARRAY[1450, 599, 1890, 6500, 7990, 320, 498, 2500])[1 + i % 8] * (0.85 + random() * 0.3))::numeric, 2),
            0, 'CZK', date '2026-10-01' - i * 17,
            (ARRAY['software', 'telecom', 'fuel', 'rent', 'material', 'software', 'travel', 'marketing'])[1 + i % 8],
            'D' || (2026000 + i), date '2026-10-01' - i * 17 + 14,
            CASE WHEN i > 1 THEN (date '2026-10-01' - i * 17 + 5)::timestamptz END,
            'Ukázková data (demo)');
  END LOOP;

  -- ---- bank statement: payments matched to paid invoices + a few strays -------
  INSERT INTO bank_statement_imports (tenant_id, filename, source, imported_at)
  VALUES (v_tenant, 'seed-vypis-2026-09.csv', 'csv', now() - interval '2 days')
  RETURNING id INTO v_import;

  INSERT INTO bank_transactions (tenant_id, import_id, transaction_date, amount, currency, variable_symbol,
                                 counterparty_account, counterparty_name, matched_invoice_id, status)
  SELECT v_tenant, v_import, inv.paid_at, t.total, inv.currency, inv.variable_symbol,
         '1234567890/0800', c.legal_name, inv.id, 'matched'
  FROM invoices inv
  JOIN contacts c ON c.id = inv.contact_id
  JOIN LATERAL (
    SELECT round(sum(li.quantity * li.unit_price * (1 - li.discount_percent / 100)), 2) AS total
    FROM invoice_line_items li WHERE li.invoice_id = inv.id
  ) t ON true
  WHERE inv.tenant_id = v_tenant AND inv.internal_note = 'Ukázková data (demo)' AND inv.status = 'paid'
    AND inv.paid_at > now() - interval '60 days';

  INSERT INTO bank_transactions (tenant_id, import_id, transaction_date, amount, currency, variable_symbol,
                                 counterparty_account, counterparty_name, status)
  VALUES
    (v_tenant, v_import, now() - interval '6 days', 4840.00, 'CZK', '20269999', '2001234567/2010', 'Neznámý plátce', 'unmatched'),
    (v_tenant, v_import, now() - interval '4 days', -1450.00, 'CZK', NULL, '19-2000145399/0800', 'Adobe Systems', 'unmatched'),
    (v_tenant, v_import, now() - interval '3 days', 12500.00, 'CZK', NULL, '670100-2212345678/6210', 'Kavárna U Mostu s.r.o.', 'unmatched'),
    (v_tenant, v_import, now() - interval '9 days', -89.00, 'CZK', NULL, NULL, 'Poplatek za vedení účtu', 'ignored');

  -- ---- a few notifications for the bell ---------------------------------------
  INSERT INTO notifications (tenant_id, user_id, kind, title, body, link, read_at, created_at)
  SELECT v_tenant, v_user, x.kind, x.title, x.body || ' (demo)', x.link, x.read_at, x.created_at
  FROM (VALUES
    ('invoice_paid', 'Faktura je zaplacená', 'Platbu jsme spárovali z bankovního výpisu.', '/bank', NULL::timestamptz, now() - interval '25 minutes'),
    ('invoice_viewed', 'Odběratel otevřel fakturu', 'Poprvé si ji zobrazil v klientském portálu.', '/invoices', NULL, now() - interval '3 hours'),
    ('draft_ready', 'Nový návrh faktury ke kontrole', 'Z hlasové zprávy v Telegramu.', '/invoices?status=pending_review', NULL, now() - interval '1 day'),
    ('invoice_overdue', 'Faktura je po splatnosti', 'Automatická upomínka odešla.', '/invoices?status=overdue', now() - interval '1 day', now() - interval '2 days'),
    ('bank_import', 'Výpis seed-vypis-2026-09.csv naimportován', 'Část plateb čeká na ruční spárování.', '/bank', now() - interval '2 days', now() - interval '2 days')
  ) AS x(kind, title, body, link, read_at, created_at);

  RAISE NOTICE 'Seeded % contacts, 42 documents, 24 expenses for tenant %', array_length(v_contacts, 1), v_tenant;
END $$;

# Classroom mode – plan

Billanta for schools: a teacher runs a class, every student gets their own
practice company and learns invoicing on it during the school year. Free for
schools, so the design has one overriding goal besides teaching well:

> **A classroom account must be useless for real business.** Nothing a
> student or teacher does in it can produce a document, e-mail, payment or
> data export that works outside the classroom, and there is no way to turn
> it into a real account.

The demo playground (migrations 0068/0069, `src/demo`) already solves most
of that for anonymous 24-hour visitors. Classroom mode reuses it: **a
student company is a demo tenant (`is_demo = true`) that belongs to a class
and lives until the end of the school year.** Every database trigger, guard
and watermark the demo has applies without new code; classroom mode adds the
school/class/student structure on top and closes the few doors a demo leaves
open on purpose (public links, accounting exports, demo transfer).

Status: **proposal, waiting for approval.** Nothing below is built yet.

---

## 1. Roles and flow

```
Teacher (real Billanta user, school e-mail)
  └─ applies: school name, school IČO, school e-mail domain, DPA consent
       └─ Billanta staff approves (PlatformAdminGuard, /admin/classroom)
            └─ teacher creates classes → join code + QR + printable sheet
                 └─ student opens /class/join, types code + nickname
                      └─ gets own practice company (seeded like a demo)
                         and a personal student code to sign in again
Teacher sees every company in the class read-only, sees progress per lesson,
can reset a company, regenerate a student's code, remove a student, close
enrolment or end the class early.
```

### 1.1 Teacher onboarding

1. Teacher signs up as any user (e-mail + password or Google) and opens
   `/{locale}/for-schools/apply` (also linked from the `/for-schools` landing
   page the lessons session is building).
2. Application form: school name, school IČO (looked up in ARES with the
   existing `company-lookup` so the name is pre-filled and checked), school
   e-mail domain (e.g. `gymnazium-xy.cz`), the teacher's subject (free text,
   optional), expected number of students, and two checkboxes:
   - acceptance of the **data processing agreement** (school = controller,
     Billanta = processor, see §6),
   - "I understand classroom companies are fictional and cannot be used for
     real invoicing."
3. Automatic checks before it reaches staff:
   - the teacher's e-mail is **verified** (or a Google account) and its
     domain equals the school domain or is a subdomain of it;
   - the domain is not a free-mail provider (gmail, seznam, centrum, email,
     post, azet, zoznam, outlook, …: a list in code);
   - one pending application per user, at most 3 applications per school IČO
     per week (stops spraying).
4. Billanta staff (`PlatformAdminGuard`) review at `/admin/classroom`: ARES
   data for the IČO (legal form should be a school: "školská právnická
   osoba", "příspěvková organizace", "obecně prospěšná společnost", SK
   equivalents; staff decide, the UI only highlights), the domain, the
   teacher's name. Approve / reject with a note. The teacher gets one e-mail
   (normal outbox, real account) either way.
5. Approved teacher gets a "Classroom" entry in the account menu leading to
   `/{locale}/classroom`.

The approval is per **school** (`classroom_schools`) with the teacher as a
member (`classroom_teachers`), so a second teacher of an approved school
whose e-mail matches the domain is approved automatically – staff approve
each school once. Staff can suspend a school, which closes all its classes.

### 1.2 Classes

A teacher creates a class with:

- name ("4.A – Ekonomika"), language of the companies (`cs`/`sk`/`en`),
- company kind (one of the demo kinds: `cz_vat_sro`, `cz_freelancer`,
  `cz_pausal`, `sk_vat_sro` – and whatever the Slovak demo-kinds session
  adds), the same for every student so the lessons fit,
- start empty or seeded (seeded = the demo dataset; empty = company and
  settings only, for lessons that start from zero),
- end date: default **31 August of the current school year** (classes made
  in July/August default to the next one), at most 13 months ahead,
- max students (default 35, hard cap 40).

Each class gets a **join code**: 8 characters from an unambiguous alphabet
(no 0/O/1/I/L), shown big, as a QR code to
`/{locale}/class/join?code=XXXX-XXXX` and on a printable A4 sheet.
Enrolment can be **closed** (code stops working, existing students
unaffected) and the code **rotated**. The code expires with the class.

Limits per teacher: 10 active classes. Per school: 600 active students
(staff can raise it).

### 1.3 Students

`/{locale}/class/join` (public page, no account):

1. Enter the join code → see "Class 4.A – Ekonomika, teacher J. Novák,
   school XY". (Rate-limited per IP; a wrong code says nothing more.)
2. Enter a **nickname** (2–30 characters; hint: "first name and initial of
   surname, or a nickname – no full name needed"). No e-mail, no phone, no
   birth date, no password.
3. Backend creates the student user and company (§3), and returns a
   **personal student code** (`ABCD-2345`, 8 chars). The page shows it big
   with "write it down / take a photo" and a printable card. The browser is
   signed in right away.
4. Coming back on another device: `/{locale}/class/login` → join code of the
   class + personal code. Both together, rate-limited per IP and per class,
   locked for 15 minutes after 10 failures in a class.
5. Forgotten code: the teacher regenerates it in the class view (the old one
   stops working, the student's open sessions are signed out).

Sessions are the database sessions the demo uses (`createDemoSession`),
valid 30 days rolling, never past the class end date.

The student is the **owner** of their company in the app's role model (so
the whole UI works), but every classroom restriction below applies to the
company, not the role.

### 1.4 Teacher's access to student companies

The teacher gets a membership with role **`viewer`** in each student company
when the student joins. That is plain RLS: when the teacher opens a
student's company the request runs in that tenant's context with a read-only
role, `RoleAccessGuard` refuses every write, and the demo triggers apply as
for anyone in a demo tenant. No new bypass, no cross-tenant query for the
detail view.

Classroom tenants are hidden from the teacher's normal company switcher
(30 practice companies would drown their own company); the class page opens
them ("Open company" sets the tenant cookie and shows a banner "Viewing the
company of *nickname* – read-only – back to class").

Reset, removing a student and progress counting cross tenants and go
through narrow `SECURITY DEFINER` functions that check the teacher's
membership of the class (§3.3).

---

## 2. Anti-misuse safeguards

Two layers, as in the demo: an API guard with explanatory error codes
(`classroom_disabled`, …) and **database triggers as the backstop** acting
for `faktur_app`, so a forgotten check in a controller cannot open a door.

| Risk | Safeguard | Reused / new |
|---|---|---|
| Invoicing in someone else's name, or the student's own business | Supplier identity (name, IČO, DIČ, address, bank accounts, logo, e-mail, phone, web) comes from the practice dataset and is **locked** | reused: `demo_tenants_lock`, `demo_readonly` on `tenant_bank_accounts` |
| Practice IČO looking real | Supplier IČO/DIČ from the demo dataset (fictional, fails the checksum or sits in an unused range – the dataset already guarantees this); company name gets the suffix "(cvičná firma)" / "(cvičná firma)" sk / "(practice company)" | reused dataset, new suffix in `create_classroom_student` |
| Printing a usable invoice | **Every PDF watermarked** diagonally "CVIČNÝ DOKLAD – neplatný" (sk "CVIČNÝ DOKLAD – neplatný", en "PRACTICE DOCUMENT – invalid") plus a footer line "Cvičný doklad ze školní výuky v Billantě. Nejde o daňový doklad."; **no payment QR code** | reused `drawDemoWatermark` path, new texts chosen by `tenants.classroom_class_id` |
| Sending to real customers | E-mail actions answered with an **in-app preview** (the rendered e-mail and the attached watermarked PDF) instead of sending; outbox drops anything for the tenant | reused `demo_email_outbox_drop`, `EMAIL_ACTION` block in `demo-policy.ts`; preview is new UI on existing templates |
| e-invoice (ISDOC/UBL) without a watermark | ISDOC/UBL downloads blocked | reused `demo-policy.ts` rule |
| Public invoice links, client portal, public profile, calendar/RSS feeds | **Blocked** for classroom (the demo allows watermarked public links; a classroom does not) | new: guard rules + the public-link definer functions return nothing for classroom tenants |
| Getting paid | No payment links, no card payments, no QR payment code | reused `card_payment_sessions` trigger, `card_payments_enabled` lock, QR skipped for `is_demo` |
| Bank | No bank connections (no real bank login); bank-statement **import of files** stays allowed (useful for teaching reconciliation; data stays inside) | reused trigger on `bank_connections` + `DISABLED` rule |
| API, automation | No API keys, webhooks, channel links (Telegram/WhatsApp), invitations, backup destinations | reused triggers (`api_keys`, `channel_links`, `tenant_invitations`, `backup_destinations`) + admin prefixes closed |
| AI | AI features off: `consume_demo_ai_call` finds no `demo_sessions` row and returns –1; module `ai` forced off in `enabled_modules` | reused + new module lock |
| Exports to accounting tools | **Pohoda, Money S3, CSV exports and tax XML (DPH, KH, SH, DPFDP, ...) blocked** (the demo allows them; here they would be a way out) | new guard rule on `v1/exports/*` except `annual-summary` (on screen) |
| Imports of real data | Fakturoid/iDoklad/Bitfaktura imports and attachments blocked | reused `DISABLED` rules |
| Filling the database | Row caps: invoices 150, contacts 200, expenses 200, time entries 500, bank lines 300 per company | reused `demo_row_cap` (invoices cap raised for a school year: new trigger argument for classroom) |
| Keeping it after school | Hard **expiry** at the class end date: middleware returns `classroom_expired` (410), a cron deletes the companies 14 days later (the grace lets the teacher download the progress CSV) | reused middleware check on `demo_expires_at`, `delete_demo_tenant`; new cron for classes |
| Turning it into a real account | **No conversion.** Demo transfer (`issue_demo_transfer` / `claim_demo_transfer`) works only for rows in `demo_sessions`, and classroom companies never get one; `v1/demo/*` is closed for classroom tenants; the student user is password-less with an `.invalid` address and cannot add an e-mail, password or Google login | reused definer checks + `me.controller` demo block; new guard rule |
| Teacher using the class for their own business | The teacher is only a `viewer` in student companies; the teacher's own company (if any) is a normal paid/trial account, separate | design |
| Many free "students" as a free tier | Students only through a staff-approved school; caps per class/school; one company per student; nickname-only users can't sign in anywhere else | design |
| Unattended abuse | Staff dashboard: per school active students, documents, last activity; suspend button | new |

### 2.1 What a classroom tenant forces off

`enabled_modules` is set at creation and **locked** by a classroom trigger:
`ai: false`. Everything else stays on (expenses, bank, recurring, quotes,
reports, time) because the lessons use them; the teacher may switch modules
for the class (stored on the class, copied to every company).

Forced settings on the tenant row (inside the existing demo lock):
`ai_mode`, `card_payments_enabled = false`, `webhooks = null`,
`public_profile = null`, `plan_enforced = false` (the classroom company has
every feature the plan check knows, like a demo – the guards above are
what limits it).

---

## 3. Data model

### 3.1 New global tables (no `tenant_id`)

```sql
classroom_schools (
  id uuid pk, name text, ico text, country 'CZ'|'SK', email_domain text,
  status 'pending'|'approved'|'rejected'|'suspended',
  max_active_students int default 600,
  dpa_accepted_at timestamptz, dpa_version text,
  reviewed_by_email text, reviewed_at timestamptz, review_note text,
  created_at timestamptz
)  -- unique (ico, email_domain)

classroom_teachers (
  id uuid pk, school_id → classroom_schools, user_id → users,
  status 'pending'|'approved'|'rejected', subject text,
  created_at, approved_at
)  -- unique (school_id, user_id)

classroom_classes (
  id uuid pk, school_id, teacher_id → classroom_teachers,
  name text, language 'cs'|'sk'|'en', kind text (demo kind), seeded boolean,
  modules jsonb, max_students int,
  join_code text unique, enrolment_open boolean,
  ends_at timestamptz, closed_at timestamptz, deleted_at timestamptz,
  created_at
)

classroom_students (
  id uuid pk, class_id → classroom_classes, user_id → users, tenant_id → tenants,
  nickname text, login_code_hash char(64), failed_logins int, locked_until timestamptz,
  created_at, last_seen_at, reset_count int
)  -- unique (tenant_id), unique (user_id)
```

`tenants` gets `classroom_class_id uuid null` (with `is_demo = true`,
`demo_kind`, `demo_expires_at = class.ends_at`). `users.is_demo = true` for
students, address `student-<uuid>@class.billanta.invalid` (dropped by the
outbox trigger, which already matches `@demo.billanta.invalid`; the pattern
gets the second domain).

### 3.2 RLS approach

- **Student content** (invoices, contacts, …) is ordinary tenant data under
  the existing RLS. The student works in their tenant; the teacher reads it
  as a `viewer` member of that tenant. No policy is loosened.
- **Classroom tables** are global, like `partners`. `classroom_students`
  holds the login-code hashes, so it is **invisible to `faktur_app`** (RLS
  on, no policy, like `demo_sessions`) and reached only through definer
  functions. `classroom_schools`, `classroom_teachers`, `classroom_classes`
  get SELECT/INSERT/UPDATE grants for `faktur_app`; the classroom service
  always filters by the authenticated teacher, and the definer functions
  re-check it for everything that crosses tenants.

### 3.3 SECURITY DEFINER functions (fixed `search_path`, REVOKE from PUBLIC)

| Function | What | Checks |
|---|---|---|
| `classroom_join(p_join_code, p_nickname, p_code_hash, p_tenant jsonb, p_bank jsonb)` → user, tenant, ends_at | creates student user, tenant (via the same inserts as `create_demo_tenant`), owner membership, teacher `viewer` membership, `classroom_students` row | class exists, enrolment open, not ended, school approved, class and school caps (advisory lock per class) |
| `classroom_student_login(p_join_code, p_code_hash)` → user, tenant, ends_at | sign-in again | lockout counter, class active |
| `classroom_reset_student(p_teacher_user, p_student_id)` | wipes the company's content (same delete order as `delete_demo_tenant`, keeps tenant, users, memberships), then the backend reseeds through RLS like `DemoSeedService` | caller teaches the class |
| `classroom_regenerate_code(p_teacher_user, p_student_id, p_code_hash)` | new login code, deletes the student's sessions | caller teaches the class |
| `classroom_remove_student(p_teacher_user, p_student_id)` | `delete_demo_tenant` + row | caller teaches the class |
| `classroom_progress(p_teacher_user, p_class_id)` → per student: counts only | §4 | caller teaches the class; returns **counts and dates, never document content** |
| `classroom_claim_expired(p_limit)` | cron work list (ended + 14 days) | – |

`p_teacher_user` comes from the verified JWT in the backend, the same trust
model `create_demo_tenant` uses for its inputs.

### 3.4 Migrations

One migration `00NN_classroom_mode.sql` (number taken when implementing;
the promo-codes and Slovak demo sessions may add migrations first):

1. the four tables, indexes, RLS on `classroom_students`;
2. `tenants.classroom_class_id` + FK + index; `tenants_demo_kind_check`
   left alone (kinds come from the demo);
3. the definer functions above, grants;
4. extend `demo_email_outbox_drop` with the `@class.billanta.invalid`
   domain; a `classroom_tenant_lock` trigger on `tenants` for
   `classroom_class_id` and `enabled_modules.ai`; `classroom_class_id`
   added to the `demo_tenants_lock` row so it cannot be cleared;
5. classroom variants of the row cap for `invoices` (150);
6. public-link definer functions (`get_public_invoice_*`,
   portal, feeds) return nothing for classroom tenants.

`drizzle/schema.ts`, `app-role-grants.sql` and the journal updated as the
backend AGENTS.md says.

### 3.5 Backend code

```
src/classroom/
  classroom.module.ts
  classroom-config.ts          caps, TTLs (env with defaults, like demo-config)
  classroom-policy.ts (+spec)  extra blocks on top of demoBlockFor()
  join-code.ts (+spec)         code alphabet, normalising "abcd 2345" → "ABCD-2345"
  school-year.ts (+spec)       default end date
  email-domain.ts (+spec)      free-mail list, domain matching
  lessons.ts (+spec)           lesson → milestone predicates over counts (§4)
  classroom.service.ts         teacher: apply, classes, students, reset
  classroom-join.service.ts    join/login → definer functions + DemoSeedService
  classroom-admin.controller.ts  v1/admin/classroom (PlatformAdminGuard)
  classroom.controller.ts        v1/classroom (JwtAuthGuard, teacher, pool)
  classroom-public.controller.ts v1/public/classroom/{join,login} (provision secret, like demo)
  classroom-cleanup.cron.ts
```

- `DemoGuard` calls `classroomBlockFor()` too when the tenant is a
  classroom tenant (`req.user.classroom`, set by the tenant middleware next
  to `demo`).
- `DemoSeedService` is reused as is (`seed`, `setModules`), so the Slovak
  demo-kinds work is picked up without touching `src/demo/dataset`.
- PDF: `invoice-pdf.service.ts` picks the classroom watermark texts when
  `tenant.classroomClassId` is set.

### 3.6 Frontend

- `/for-schools/apply` (application), `/classroom` (teacher: classes),
  `/classroom/[classId]` (students, progress grid, join code/QR, print
  sheet, actions), `/class/join`, `/class/login` (students), `/admin/classroom`
  (staff).
- Classroom banner in the dashboard for students ("Cvičná firma – třída
  4.A – do 31. 8. 2027") and for the teacher viewing a student company.
- E-mail actions in classroom open the preview modal instead of sending.
- `/api/classroom/join` and `/api/classroom/login` route handlers open the
  session like `/api/demo/start` (same-origin check, per-IP rate limit,
  provision secret to the backend).
- All strings in `cs`, `sk`, `en`.

---

## 4. Teacher dashboard

`/classroom/[classId]`:

- **Header:** class name, end date, enrolment open/closed, join code + QR +
  "print sheet", students n/max.
- **Progress grid:** rows = students (nickname, last activity), columns =
  lessons. A cell is ✓ done, ◐ started, – not yet. Click a cell to see the
  milestones of that lesson for that student ("issued invoice ✓, credit
  note –").
- **Per student actions:** open company (read-only), reset company,
  new student code, remove.
- **Class actions:** close/open enrolment, rotate join code, extend end date
  (once, up to 31 Aug), end class now, download progress CSV.
- **Totals:** documents issued in the class this week (a teacher sees the
  class is working).

### 4.1 Lessons and milestones

The lessons are written in another session (`/for-schools/lessons`). To
stay decoupled, progress is computed from **milestones**, facts that
`classroom_progress` can count in each company without reading content:

| Milestone | Counted as |
|---|---|
| `contact_created` | a contact created after seeding |
| `invoice_issued` | an invoice (not draft) created after seeding |
| `invoice_vat` | an issued invoice with a VAT line ≠ 0 % |
| `invoice_foreign_currency` | an issued invoice in a currency ≠ CZK/EUR home |
| `invoice_reverse_charge` | an issued invoice with reverse charge |
| `proforma_converted` | a proforma converted into a tax document |
| `quote_created` | a quote created |
| `credit_note_issued` | a credit note issued |
| `invoice_paid` | an invoice marked paid (or matched to a bank line) |
| `bank_matched` | a bank line matched |
| `expense_recorded` | an expense created |
| `recurring_created` | a recurring template created |
| `time_logged` | a time entry created |
| `vat_report_opened` | – (needs an event; phase 2) |

`lessons.ts` maps lesson slugs to the milestones they require, e.g.
`first-invoice: [contact_created, invoice_issued]`,
`credit-notes: [credit_note_issued]`. A lesson is done when all are met,
started when some are. The lesson session only has to tell us the slugs
and pick milestones from this list; adding a milestone is one SQL count.

"After seeding" uses the reset time / creation time stored on
`classroom_students` so the seeded data does not count as the student's
work.

---

## 5. MVP scope (what step 2 builds)

In:

1. Migration, schema, grants, definer functions, triggers (§3).
2. Teacher application + staff approval (API + simple pages).
3. Classes: create, list, join code, QR, close enrolment, rotate code.
4. Student join with nickname + personal code, login again, session.
5. Student companies seeded via `DemoSeedService`, teacher `viewer`
   membership, "open company" read-only.
6. All safeguards in §2 (guard + triggers), classroom watermark texts,
   e-mail preview instead of sending (preview of the existing e-mail text
   and the PDF; no in-app inbox yet).
7. Reset, regenerate code, remove student.
8. Progress grid from milestones with a first `lessons.ts` mapping (adjusted
   when the lessons land).
9. Expiry + cleanup cron.
10. Tests: policy spec (every blocked route), join code, school year,
    e-mail domain, lessons mapping; a DB integration check of the definer
    functions and triggers in a rolled-back transaction as `faktur_app`
    where the existing test setup allows it.

Later:

- In-app inbox where students "send" invoices to each other (a classmate
  receives it, can accept a quote or record it as an expense) – a great
  lesson, but its own design.
- Teacher-defined assignments with deadlines, comments on a student's
  document.
- ISDOC with a "practice" note for e-invoicing lessons.
- Bulk class creation from a CSV of nicknames (pre-generated codes on
  printable cards, for younger students without a device at hand).
- SSO with school Google/Microsoft accounts (would let us drop personal
  codes for schools that have it).

---

## 6. GDPR for minors

- **Roles:** the school is the controller (it decides to use Billanta in
  teaching), Billanta is the processor. The teacher accepts a data
  processing agreement on behalf of the school when applying (versioned,
  stored with the school). Legal text to be prepared/reviewed separately.
- **Minimal data:** nickname (teacher instructs: no full name), the
  practice company content, a hashed login code, technical timestamps. No
  e-mail, phone, birth date, photo, address or IP (rate limits use a
  salted IP hash with a 24 h window, as the demo). Nicknames are not shown
  to anyone outside the class.
- **No consent from the child is needed** for this processing (performed
  for the school's educational purpose, not an information society service
  offered to the child), which is why no age gate is required; the teacher
  confirms the school informs students/parents. Still to be confirmed by a
  lawyer – flagged as an open question.
- **Retention:** student companies and users are deleted 14 days after the
  class ends; removing a student deletes immediately; the teacher's account
  and the school record stay (they are adults' data under the normal terms).
- **No marketing:** student users never get e-mails (they have none), no
  tracking/analytics cookies on `/class/*` pages, no referral or upsell
  banners in classroom companies.
- **Rights:** the teacher can show/export a student's company (PDFs) and
  delete it on request.

---

## 7. Open questions for the user

1. **Teacher identity:** is school e-mail domain + staff approval enough,
   or do you also want a signed paper/PDF from the school (head teacher)
   before the first class? (Plan: domain + approval; paper later if abuse
   shows up.)
2. **ARES lookups** for buyers in student companies: allowed (real company
   names on watermarked practice invoices that never leave the app) or
   forced fictional contacts only? (Plan: allowed – it's how real invoicing
   works.)
3. **Bank statement file import:** allowed (plan) or blocked?
4. **Who may see student nicknames:** teacher only (plan), or other
   teachers of the same school too?
5. **Pricing/limits:** free for approved schools with the caps above –
   confirm the numbers (40 per class, 10 classes per teacher, 600 per
   school, 150 invoices per company).
6. The DPA text – do you have a lawyer, or should I draft one for review?

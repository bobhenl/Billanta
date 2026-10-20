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

Status: **approved, MVP built** (round three). Round two took in the
owner's feedback: e-mail domain only optional, practice of several company
types and the accountant role, modules per class, co-teachers, renewal
across school years, generous limits, and a DPA draft
(`docs/classroom-dpa-draft.md`). Round three settled the difficulty tracks,
co-teacher approval, retention and the DPA process (section 7). Where the
build differs from the text below, section 7.2 says how.

---

## 1. Roles and flow

```
Teacher (real Billanta user, any e-mail)
  └─ applies: school (IČO via ARES), level, DPA consent
       └─ Billanta staff verify the teacher and approve the school
            └─ teacher creates classes → join code + QR + printable sheet
                 └─ student scans the QR (/join/CODE), types a nickname
                      └─ gets own practice company (seeded like a demo)
                         and a personal re-entry code for other devices
Teacher sees every company in the class read-only, sees progress per lesson,
can reset a company, regenerate a student's code, remove a student, close
enrolment or end the class early.
```

### 1.1 Teacher onboarding

1. Teacher signs up as any user (e-mail + password or Google; **any
   e-mail**, a school address is not required) and opens
   `/{locale}/for-schools/apply` (also linked from the `/for-schools`
   landing page the lessons session is building).
2. Application form:
   - school IČO, looked up with the existing `company-lookup` (ARES for CZ,
     the SK registry for SK), so name, address and legal form are pre-filled
     and checked;
   - **school level**: ZŠ, SŠ (incl. obchodní akademie), VOŠ, VŠ, course
     (retraining, adult education). Used for sensible defaults (which
     company types, seeded or empty) and for our own statistics, not as
     separate products;
   - the school web page where the teacher is listed (optional) and the
     school e-mail domain (optional);
   - subject (free text, optional), expected number of students;
   - two checkboxes: acceptance of the **data processing agreement**
     (school = controller, Billanta = processor, §6 and the DPA draft), and
     "I understand classroom companies are fictional and cannot be used for
     real invoicing."
3. Verification is **light and human**, because schools differ (many small
   schools have no own domain, teachers use seznam.cz or gmail):
   - **fast path:** the teacher's verified e-mail is on the school's domain
     → staff see a green "domain matches" badge and approve in one click;
   - **otherwise** staff verify by hand: the teacher on the school web page,
     a short call or e-mail to the school office, or an agreement with the
     school (e.g. a partnership with an obchodní akademie). A free-mail
     address is **not** rejected, only shown to staff;
   - anti-spam only: one pending application per user, at most 3 per school
     IČO per week.
4. Billanta staff (`PlatformAdminGuard`) review at `/admin/classroom`: the
   registry data (legal form should be a school: "školská právnická
   osoba", "příspěvková organizace", "obecně prospěšná společnost", SK
   equivalents; the UI only highlights, staff decide), the domain badge,
   the note of how they verified. Approve / reject with a note. The teacher
   gets one e-mail (normal outbox, real account) either way.
5. Approved teacher gets a "Classroom" entry in the account menu leading to
   `/{locale}/classroom`.

The approval is per **school** (`classroom_schools`) with teachers as
members (`classroom_teachers`). Another teacher of an approved school is
approved automatically when their e-mail is on the school domain, or when
an already approved teacher of that school **invites** them; otherwise
staff confirm them like the first one. Staff can suspend a school, which
closes all its classes.

### 1.2 Classes

A teacher creates a class with:

- name ("4.A – Ekonomika"), language of the companies (`cs`/`sk`/`en`);
- **company types the class practises**: one or more of the demo kinds
  (`cz_freelancer` OSVČ, `cz_pausal` OSVČ v paušálním režimu, `cz_vat_sro`
  s.r.o. plátce DPH, `sk_vat_sro`, and whatever the Slovak demo-kinds
  session adds). With one type every student gets it; with several the
  student picks one when joining, or the teacher assigns them (useful for
  "half the class is OSVČ, half is s.r.o." lessons);
- start empty or seeded (seeded = the demo dataset; empty = company and
  settings only, for lessons that start from zero);
- **modules** the class uses (expenses, bank, recurring, quotes, reports,
  time). The teacher switches them on and off at any time, e.g. only
  invoices and contacts for the first lessons, bank and expenses later;
  the change is copied to every company in the class. AI stays off
  regardless (§2.1);
- **working mode**: everyone their own company (default) or **teams**
  (the teacher names teams, a student picks one when joining, the team
  shares one company; phase 2, see §5);
- end date: default **31 August of the current school year** (classes made
  in July/August default to the next one), at most 13 months ahead, and
  **renewable** (below);
- max students (default 35).

Each class gets a **join code** on the shared group-code mechanism the
promo-codes session is building (§1.5): a `kind: school_class` code with
the join URL `/{locale}/join/CODE`, shown big, as a QR code and on a
printable A4 sheet. The code is typed as a short passphrase (8 characters
from an unambiguous alphabet, no 0/O/1/I/L, or a word pair if that
mechanism offers one). Enrolment can be **closed** (code stops working,
existing students unaffected) and the code **rotated**. The code expires
with the class.

**Renewal across school years.** Multi-year subjects (e.g. a 3rd and 4th
year of an obchodní akademie) keep their companies: the teacher
**extends** the class by up to one more school year at a time, as often
as needed, and may rename it ("3.A" → "4.A"). Students keep their
companies, codes and history. 30 days and again 7 days before the end the
teacher gets an e-mail ("Class 3.A ends on 31 August, extend it or
download the progress CSV"). After the end the companies stay read-only
for 30 days (the teacher can still extend), then they are deleted.

**Limits** are generous and exist only as brakes against filling the
database by a script or a mistake, never as a sales lever: 60 students
per class, 30 active classes per teacher, 2 000 active students per
school. Staff can raise any of them for a school with one field.

### 1.3 Students

Joining is **one or two steps**; the teacher creates nothing per student:

1. The student scans the class QR (or types the passphrase at
   `/{locale}/join`) and lands on `/{locale}/join/CODE`: "Class 4.A –
   Ekonomika, teacher J. Novák, school XY". (Rate-limited per IP; a wrong
   code says nothing more.)
2. They type a **nickname** (2–30 characters; hint: "first name and
   initial of surname, or a nickname – no full name needed") and press
   "Enter my company". No e-mail, no phone, no birth date, no password.
   The backend creates the student user and company (§3) and the browser
   is signed in on the spot, in the dashboard of their practice company.

Coming back:

- **Same device:** a device-bound session (httpOnly cookie, the database
  session the demo uses via `createDemoSession`) that lasts two weeks
  at most and never past the company's deletion. Nothing to type until
  then; school computers are shared, so it doesn't last longer.
- **Another device or a cleared browser:** a **personal re-entry code**
  (`ABCD-2345`, 8 chars) the student sees in the classroom banner of their
  company ("Your code to get back in"). The **teacher sees every student's
  code** in the class view and can print them as cut-out cards, so a lost
  code is never a problem. Re-entry: `/{locale}/join/CODE` → "I'm already
  in this class" → re-entry code. Rate-limited per IP and per class, locked
  for 15 minutes after 10 failures in a class.
- The teacher can **regenerate** a code (the old one stops working and the
  student's sessions on other devices are signed out).

Why this is safe without an e-mail: the re-entry code opens only one
practice company with fictional data, inside one class, until the end of
the school year, and it works nowhere else in Billanta. It is stored
encrypted (the existing `encryption.util.ts`, so the teacher can read it)
and as a hash for the lookup.

The student is the **owner** of their company in the app's role model (so
the whole UI works), but every classroom restriction below applies to the
company, not the role. The owner role does not let them remove the
teacher: team management is closed for demo tenants already, and a new
trigger refuses deleting or downgrading the teacher's membership in a
classroom tenant (the classroom functions are the only way to change it).

**Practising roles** (phase 2 unless noted):

- *OSVČ vs. s.r.o. vs. plátce DPH*: the company types above (MVP).
- *Several companies per student*: the teacher can give a student a second
  company of another type ("now do the same as a VAT payer"); the data
  model has companies separate from students for this.
- *Accountant*: the student gets the `accountant` role in a seeded client
  company or in a classmate's company (the teacher pairs them) and does
  the accountant's work there: checks documents, records expenses, runs
  the reports. The role model and RLS already support it; classroom only
  creates the membership.

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

**More teachers.** No shared login: every teacher has their own account,
and a class has an owner teacher plus **co-teachers**
(`classroom_class_teachers`). The owner adds a colleague who is an
approved teacher of the same school; a co-teacher sees the class, the
nicknames and re-entry codes, opens companies read-only and can reset a
company, but cannot delete the class or remove the owner. Each teacher
gets their own `viewer` membership in the student companies, so access
is per person and leaves with them. Nicknames are visible only to the
teachers of that class and the classmates of a team.

### 1.5 Dependency: shared group codes (promo-codes branch)

The promo-codes session (branch `claude/promo-codes-2db91c`) is building
generic group codes with a join URL `/join/CODE` and a pluggable `kind`,
also for events and coworkings. Classroom mode does **not** build its own
code system; a class code is a `kind: school_class` on it:

- the code row lives in the shared catalogue (unique across all kinds, so
  `/join/CODE` resolves to exactly one thing); `classroom_classes.code_id`
  points to it, and the code carries no plan benefit;
- classroom registers a **join-kind handler** with the interface below; the
  shared `/join/CODE` page asks the handler for the preview and the form,
  and the shared backend route dispatches the join to it.

```ts
interface JoinKindHandler {
  kind: "school_class";
  /** What the landing page shows; null = unknown or closed code (same answer). */
  preview(code: string): Promise<JoinPreview | null>;
  /** For school_class the input is the nickname; says whom to sign in and where to land. */
  join(code: string, input: unknown, ctx: { ipBucket: string }): Promise<JoinResult>;
  /** Re-entry with a personal code (school_class only). */
  reenter?(code: string, personalCode: string, ctx: { ipBucket: string }): Promise<JoinResult>;
}
type JoinResult = { userId: string; tenantId: string; sessionExpiresAt: string; redirect: string };
```

Until that branch lands, `src/classroom/join-kind.ts` holds this interface
and the classroom implementation; a local stub generates and stores the
code on `classroom_classes.join_code`, and a minimal `/{locale}/join/[code]`
page calls the classroom handler directly. When promo-codes merges, the stub
gives way to the shared code row and the page to the shared one; the
handler stays. I'll agree the exact shape with that session before
implementing, so neither side has to rework.

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
| Imports of real data | Fakturoid/iDoklad/Bitfaktura imports (they need a real account's API key) and attachments blocked; **file imports allowed**: bank statements and CSV (contacts, items), because they teach and nothing leaves the app | reused `DISABLED` rules; classroom relaxes the demo's block for the file imports |
| Registries | ARES, RES, VIES and the SK registry lookups **allowed** (only an IČO/DIČ goes out, it is how real invoicing works) | design |
| Filling the database | Generous row caps, only against scripts: invoices 1 000, contacts 500, expenses 1 000, time entries 2 000, bank lines 2 000 per company (a multi-year class needs room) | reused `demo_row_cap`, with classroom values |
| Keeping it after school | **Expiry** at the class end date, renewable by the teacher (§1.2): after the end the companies are read-only for 30 days, then a cron deletes them; reminder e-mails to the teacher at 30 and 7 days before the end | reused middleware check on `demo_expires_at`, `delete_demo_tenant`; new cron for classes |
| Turning it into a real account | **No conversion.** Demo transfer (`issue_demo_transfer` / `claim_demo_transfer`) works only for rows in `demo_sessions`, and classroom companies never get one; `v1/demo/*` is closed for classroom tenants; the student user is password-less with an `.invalid` address and cannot add an e-mail, password or Google login | reused definer checks + `me.controller` demo block; new guard rule |
| Teacher using the class for their own business | The teacher is only a `viewer` in student companies; the teacher's own company (if any) is a normal paid/trial account, separate | design |
| Many free "students" as a free tier | Students only through a staff-approved school; caps per class/school; nickname-only users can't sign in anywhere else; nothing they make works outside the class | design |
| Student locking the teacher out | Teacher membership protected by a trigger; team endpoints closed | new trigger, reused guard |
| Unattended abuse | Staff dashboard: per school active students, documents, last activity; suspend button | new |

### 2.1 What a classroom tenant forces off

`enabled_modules` is set at creation and **locked** by a classroom trigger:
`ai: false`, and the other modules can be changed only by the class (the
student cannot switch modules in their company). The teacher picks the
modules per class (§1.2); they are stored on the class and copied to every
company of the class.

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
  id uuid pk, name text, ico text, country 'CZ'|'SK',
  level 'zs'|'ss'|'vos'|'vs'|'course',
  email_domain text null, web_url text null,
  status 'pending'|'approved'|'rejected'|'suspended',
  verification text null,           -- how staff verified ("domain", "phoned office", ...)
  max_active_students int default 2000,
  dpa_accepted_at timestamptz, dpa_version text,
  reviewed_by_email text, reviewed_at timestamptz, review_note text,
  created_at timestamptz
)  -- unique (country, ico)

classroom_teachers (
  id uuid pk, school_id → classroom_schools, user_id → users,
  status 'pending'|'approved'|'rejected', subject text,
  invited_by → classroom_teachers null,
  created_at, approved_at
)  -- unique (school_id, user_id)

classroom_classes (
  id uuid pk, school_id, owner_teacher_id → classroom_teachers,
  name text, language 'cs'|'sk'|'en',
  kinds text[] (allowed demo kinds), seeded boolean,
  modules jsonb, team_mode boolean default false, max_students int,
  join_code text unique (stub; later code_id → the shared code row),
  enrolment_open boolean,
  ends_at timestamptz, closed_at timestamptz, deleted_at timestamptz,
  reminded_at timestamptz, created_at
)

classroom_class_teachers (
  class_id, teacher_id, role 'owner'|'co_teacher', added_at
)  -- pk (class_id, teacher_id)

classroom_companies (
  id uuid pk, class_id, tenant_id → tenants unique, kind text,
  team_name text null, seeded_at timestamptz, reset_count int, created_at
)

classroom_students (
  id uuid pk, class_id → classroom_classes, user_id → users unique,
  nickname text, reentry_code_hash char(64), reentry_code_encrypted text,
  failed_logins int, locked_until timestamptz,
  created_at, last_seen_at
)
```

A student reaches their company (or companies, or the team's company)
through ordinary `memberships` rows: `owner` in their own, `accountant`
in the one they keep books for. `classroom_companies` is what the teacher
sees and what progress is counted on; the student list joins the two.

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
  holds the re-entry codes, so it is **invisible to `faktur_app`** (RLS
  on, no policy, like `demo_sessions`) and reached only through definer
  functions. `classroom_schools`, `classroom_teachers`, `classroom_classes`
  get SELECT/INSERT/UPDATE grants for `faktur_app`; the classroom service
  always filters by the authenticated teacher, and the definer functions
  re-check it for everything that crosses tenants.

### 3.3 SECURITY DEFINER functions (fixed `search_path`, REVOKE from PUBLIC)

| Function | What | Checks |
|---|---|---|
| `classroom_join(p_join_code, p_nickname, p_kind, p_code_hash, p_code_encrypted, p_tenant jsonb, p_bank jsonb)` → user, tenant, ends_at | creates student user, tenant (via the same inserts as `create_demo_tenant`), owner membership, a `viewer` membership for every teacher of the class, `classroom_companies` and `classroom_students` rows | class exists, enrolment open, not ended, school approved, kind allowed, class and school caps (advisory lock per class) |
| `classroom_student_login(p_join_code, p_code_hash)` → user, tenant, ends_at | re-entry on another device | lockout counter, class active |
| `classroom_students_of(p_teacher_user, p_class_id)` → nickname, encrypted code, companies, dates | the teacher's student list | caller teaches the class |
| `classroom_add_teacher(p_owner_user, p_class_id, p_teacher_id)` / `classroom_remove_teacher(...)` | co-teachers; adds or removes their `viewer` memberships in all companies of the class | caller owns the class, teacher approved at the same school |
| `classroom_extend(p_teacher_user, p_class_id, p_ends_at)` | new end date on the class and every company (`demo_expires_at`) | caller owns the class, at most one school year ahead of today |
| `classroom_reset_student(p_teacher_user, p_student_id)` | wipes the company's content (same delete order as `delete_demo_tenant`, keeps tenant, users, memberships), then the backend reseeds through RLS like `DemoSeedService` | caller teaches the class |
| `classroom_regenerate_code(p_teacher_user, p_student_id, p_code_hash, p_code_encrypted)` | new re-entry code, deletes the student's other sessions | caller teaches the class |
| `classroom_remove_student(p_teacher_user, p_student_id)` | `delete_demo_tenant` + row | caller teaches the class |
| `classroom_progress(p_teacher_user, p_class_id)` → per student: counts only | §4 | caller teaches the class; returns **counts and dates, never document content** |
| `classroom_claim_expired(p_limit)` | cron work list (ended + 30 days) | – |

`p_teacher_user` comes from the verified JWT in the backend, the same trust
model `create_demo_tenant` uses for its inputs.

### 3.4 Migrations

One migration `0074_classroom_mode.sql` (number taken when implementing;
the promo-codes and Slovak demo sessions may add migrations first):

1. the four tables, indexes, RLS on `classroom_students`;
2. `tenants.classroom_class_id` + FK + index; `tenants_demo_kind_check`
   left alone (kinds come from the demo);
3. the definer functions above, grants;
4. extend `demo_email_outbox_drop` with the `@class.billanta.invalid`
   domain; a `classroom_tenant_lock` trigger on `tenants` for
   `classroom_class_id` and `enabled_modules`; a trigger on `memberships`
   protecting the teachers' memberships in classroom tenants; `classroom_class_id`
   added to the `demo_tenants_lock` row so it cannot be cleared;
5. classroom values for the row caps;
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
  join-kind.ts                 JoinKindHandler interface (§1.5) + the school_class handler
  join-code.ts (+spec)         code alphabet, "abcd 2345" → "ABCD-2345"; stub until promo-codes
  school-year.ts (+spec)       default end date
  email-domain.ts (+spec)      domain matching for the staff badge
  lessons.ts (+spec)           lesson → milestone predicates over counts (§4)
  classroom.service.ts         teacher: apply, classes, students, reset
  classroom-join.service.ts    join/login → definer functions + DemoSeedService
  classroom-admin.controller.ts  v1/admin/classroom (PlatformAdminGuard)
  classroom.controller.ts        v1/classroom (JwtAuthGuard, teacher, pool)
  classroom-public.controller.ts v1/public/classroom/{preview,join,reenter} (provision secret,
                                 like demo); gives way to the shared /join dispatch later
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
  `/classroom/[classId]` (students with their re-entry codes, progress
  grid, join code/QR, print sheet and code cards, actions),
  `/join/[code]` (students: nickname, or "I'm already in" + re-entry code;
  a stub until the shared page from promo-codes), `/admin/classroom`
  (staff).
- Classroom banner in the dashboard for students ("Cvičná firma – třída
  4.A – do 31. 8. 2027") and for the teacher viewing a student company.
- E-mail actions in classroom open the preview modal instead of sending.
- `/api/classroom/join` and `/api/classroom/reenter` route handlers open the
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
- **Per student actions:** show/print re-entry code, open company
  (read-only), reset company, new re-entry code, remove.
- **Class actions:** close/open enrolment, rotate join code, modules,
  co-teachers, extend to the next school year (and rename), end class now,
  download progress CSV.
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
2. Teacher application + staff approval with the domain fast path and
   manual verification (API + simple pages).
3. Classes: create (several company types, modules), list, join code, QR,
   close enrolment, rotate code, extend/renew, co-teachers.
4. Student join by QR/passphrase + nickname (+ company type when the class
   has several), device-bound session, re-entry code the teacher can see,
   behind the `JoinKindHandler` interface (stubbed code until promo-codes
   lands).
5. Student companies seeded via `DemoSeedService`, teacher `viewer`
   memberships, "open company" read-only, teacher membership protected.
6. All safeguards in §2 (guard + triggers), classroom watermark texts,
   e-mail preview instead of sending (preview of the existing e-mail text
   and the PDF; no in-app inbox yet).
7. Reset, regenerate code, remove student.
8. Progress grid from milestones with a first `lessons.ts` mapping (adjusted
   when the lessons land).
9. Expiry, reminder e-mails to the teacher, cleanup cron.
10. Tests: policy spec (every blocked route), join code, school year,
    e-mail domain, lessons mapping; a DB integration check of the definer
    functions and triggers in a rolled-back transaction as `faktur_app`
    where the existing test setup allows it.

Later:

- Teams sharing one company; a second company per student; the accountant
  exercise (accountant role in a client or classmate's company). The data
  model in §3.1 already allows all three.
- In-app inbox where students "send" invoices to each other (a classmate
  receives it, can accept a quote or record it as an expense) – a great
  lesson, but its own design.
- Teacher-defined assignments with deadlines, comments on a student's
  document.
- ISDOC with a "practice" note for e-invoicing lessons.
- Bulk class creation from a CSV of nicknames (pre-generated codes on
  printable cards, for younger students without a device at hand).
- SSO with school Google/Microsoft accounts (would let us drop re-entry
  codes for schools that have it).
- Events and coworkings on the same join mechanism are the promo-codes
  session's; classroom only adds its kind.

---

## 6. GDPR for minors

- **Roles:** the school is the controller (it decides to use Billanta in
  teaching), Billanta is the processor. The teacher accepts a data
  processing agreement on behalf of the school when applying (versioned,
  stored with the school). Draft: `docs/classroom-dpa-draft.md`, to be
  reviewed by a lawyer before the first school signs.
- **Minimal data:** nickname (teacher instructs: no full name), the
  practice company content, a hashed login code, technical timestamps. No
  e-mail, phone, birth date, photo, address or IP; the re-entry code is
  stored encrypted and hashed and shown only to the student and their
  teacher (rate limits use a
  salted IP hash with a 24 h window, as the demo). Nicknames are not shown
  to anyone outside the class.
- **No consent from the child is needed** for this processing (performed
  for the school's educational purpose, not an information society service
  offered to the child), which is why no age gate is required; the teacher
  confirms the school informs students/parents. Still to be confirmed by a
  lawyer – flagged as an open question.
- **Retention:** as long as the class runs (the teacher may renew it for
  the next school year), then 30 days read-only and deletion; removing a
  student deletes immediately; nightly backups roll the deleted data out
  within their 30-day retention. The teacher's account and the school
  record stay (adults' data under the normal terms).
- **No marketing:** student users never get e-mails (they have none), no
  tracking/analytics cookies on `/join/*` and in classroom companies, no referral or upsell
  banners in classroom companies.
- **Rights:** the teacher can show/export a student's company (PDFs) and
  delete it on request.

---

## 7. Decisions and what is still open

Decided in round two:

- E-mail domain is optional; staff verify by hand otherwise.
- School level is a field, not a separate product.
- ARES and the other registries allowed; bank statement and CSV file
  imports allowed, API imports from other invoicing apps blocked.
- Nicknames visible to the teachers of the class only; more teachers work
  as co-teachers with their own accounts.
- Limits generous, only against abuse, staff can raise them.
- Classes renewable across school years.

Decided in round three:

- **Difficulty tracks, picked per class.** *Basic* (primary schools): the
  first invoice, contacts, a sole trader without VAT. *Standard*
  (secondary and business schools): VAT, proformas, credit notes, bank,
  expenses, quotes. *Advanced*: adds reverse charge, foreign currencies
  and the VAT reports. The school level only pre-fills the choice; any
  school can pick any track, so there is no restriction to secondary
  schools or universities.
- **Co-teachers.** A colleague of the same school invited by an approved
  teacher is approved automatically. Only the class owner adds or removes
  co-teachers and deletes the class.
- **Retention.** The class page has a status card with the end and
  deletion dates, "extend" and the progress download; the owner gets an
  e-mail 30 and 7 days before the class ends (deletion follows 30 days
  later). No AI anywhere in a class.
- **Storage.** PDFs are rendered on demand and never stored, Postgres
  TOAST compresses the text, backups are gzipped, and the per-class and
  per-school caps bound the growth.
- **DPA as a click-through.** No signature; a PDF only when a school asks.
  A school's own DPA template is handled when one actually arrives.
- **No parent consent.** Students are anonymous under a nickname and the
  school is the controller.
- **Backups** stay where they are for now: without names the risk is low.
  Moving them to an EU object store is a later step.
- **No lawyer for now.** The draft goes to the data protection officer of
  a friendly school for feedback.

### 7.1 Still open

1. The DPA: feedback from the friendly school's DPO, then publish the
   school terms (the application form links the general DPA until then).
2. Teams, second companies and the accountant exercise: phase 2.
3. The EU backup destination for the sub-processor list.

### 7.2 Deviations of the MVP from this plan

- `classroom_students` is readable by the application role. The progress
  grid and the re-entry check read it directly; the rows hold nicknames
  and code hashes only, and RLS still guards every tenant's data.
- There is no `classroom_companies` table. A student company is a demo
  tenant with `tenants.classroom_class_id` set, which is all the joins
  need.
- Accounting exports stay open in a class company: everything in it is
  watermarked practice data, and students learn the export too.
- Modules are fixed when the class is created (from the track); the
  teacher cannot change them later.
- The join code is a stub on `classroom_classes.join_code` until the
  shared group codes from the promo-codes branch land; `join-kind.ts`
  (`JoinKindHandler`) is the seam they will plug into.
- Deleting a teacher's account first deletes the classes they own, with
  every student company (`classroom_delete_class`); co-taught classes
  stay with their owner.
- The public join routes are limited per visitor in the backend too
  (preview 300, join 100, re-entry 80 per 10 minutes), loose because a
  whole class joins from one school IP.
- Demo and student sessions are not slid forward by Auth.js; they end
  when they were opened to end.

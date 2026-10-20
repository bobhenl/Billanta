# Classroom mode – review from a school DPO's point of view

> **Not legal advice.** This review was written by an AI assistant playing
> the role of the data protection officer (pověřenec pro ochranu osobních
> údajů / zodpovedná osoba) of a typical Czech public school (one ZŠ, one
> SŠ) and, separately, of a Slovak public school. I am not a lawyer. Statute
> references are from general knowledge and must be checked by a real DPO
> or lawyer before anyone relies on them. Facts about Billanta were checked
> against the code at commit `4321996` on 2026-10-21; facts about the
> production server were checked against `deploy/` and a public RDAP lookup
> of the server IP, not by logging in.
>
> Companion documents: `docs/classroom-dpa-draft.md` (Czech DPA, now
> `classroom-dpa-0.2`) and `docs/classroom-dpa-draft.sk.md` (Slovak).

## 0. Verdict

**Could a school sign this today? No.**

The contract text is now close to what a school DPO would accept, but
three things a DPO will check in the first ten minutes are not true yet:

1. **Production runs over plain HTTP** (`http://149.56.99.247:8090`, no TLS).
   Nicknames, re-entry codes and session cookies cross the network
   unencrypted. No DPO can sign "appropriate security" (Art. 32) over that.
2. **The wrong person "signs".** The teacher clicks; the acceptance is
   stored on `classroom_teachers`, not on the school, and the apply form
   says "Nic se nepodepisuje" and links the *general* DPA (`/legal/dpa`), not
   the school DPA. A teacher at a CZ/SK public school normally cannot
   conclude a controller–processor contract for the school.
3. **The counterparty and the hosting location are unknown or misdescribed.**
   The operator identity is still `[Název provozovatele], IČO [00000000]…`,
   and the privacy policy and the 0.1 draft say "datacentrum v EU", while
   the server IP belongs to **OVH Hosting, Inc., Montreal, Canada** (RDAP,
   range `OVH-VPS-149-56-96`). Canada has an adequacy decision, so this is
   fixable either way, but the contract must say what is true.

Once the blocking items in section 9 are done, I would expect a typical
Czech or Slovak school DPO to accept the 0.2 text with minor edits.

## 1. What the processing actually is (verified)

| Item | Fact in code | Where |
|---|---|---|
| Pupil identity | nickname 2–30 chars, NFC-normalised; synthetic user `student-<uuid>@class.billanta.invalid`, no password, `is_demo` | `classroom.dto.ts`, `0080_classroom_mode.sql` |
| Re-entry code | 8 chars, stored as HMAC-SHA256 (`CLASSROOM_CODE_SECRET`) **and** AES-256-GCM ciphertext; teacher can display and print all codes | `codes.ts`, `join-kind.ts` |
| Pupil session | DB session, max 14 days, never past the company's deletion | `classroom-config.ts`, `demo-session.ts` |
| Brute force | 10 wrong codes per class → 15 min lock; in-memory IP rate limits (frontend join 80 / re-entry 60 per 10 min, backend preview 300 / join 100 / re-entry 80 per 10 min) | `0080`, `rate-limit.ts`, controllers |
| IP addresses | only used as keys of in-memory sliding windows, **never persisted**; the 0.1 draft's "salted hash valid 24 h" is not what classroom does (`ipSalt` is read but unused) | `public-classroom.controller.ts`, `classroom-config.ts` |
| Teacher access | each class teacher is a `viewer` (read-only) member of every pupil company; progress CSV; regenerate code; remove pupil (immediate delete); delete class; co-teachers | `classroom.controller.ts`, `classroom-classes.service.ts` |
| Isolation | Postgres RLS per company, app role `faktur_app` NOBYPASSRLS; triggers lock modules and class; row caps; outbound e-mail from pupil companies dropped | `0080` |
| Pupil company limits | no e-mail sending, no bank/API/webhook, AI off (`ai_mode 'off'`), cannot be converted to a real account | `0080`, plan §6 |
| Retention | class end + 30 days read-only (`CLASSROOM_GRACE_DAYS`), then `classroom_delete_class` by cron every 15 min; reminders to owner teacher 30 and 7 days before end; deleting a teacher account deletes their classes | `classroom.cron.ts` |
| Backups (prod) | daily `pg_dump`, `age`-encrypted if `BACKUP_AGE_RECIPIENT` is set (key offline with owner), local 14 days, `rclone` to Google Drive, remote pruned after 60 days | `deploy/maintenance.sh` |
| Hosting | single shared VPS (also runs two other products), Docker, no TLS yet; IP registered to OVH Hosting, Inc. (Canada); Cloudflare planned | `deploy/`, RDAP |
| Analytics | Microsoft Clarity only on `(marketing)` pages and consent-gated; `/join` (under `(auth)`) and the dashboard have none | `clarity.tsx`, layouts |
| School record | country, IČO, name, level, legal form, address, web, e-mail domain, verification, caps; **no school contact or DPO e-mail** | `classroom_schools` |
| DPA acceptance | `terms_version = "classroom-dpa-0.1"` and `terms_accepted_at` on `classroom_teachers` | `classroom-config.ts`, apply form |
| Registry lookup | ARES / SK registries can be used in pupil companies; they return public data that may include **real sole traders (natural persons)** | demo modules |

## 2. Art. 28(3) checklist

"0.1" is the draft as it was; "0.2" is the rewritten draft in this commit.

| Art. 28 element | 0.1 | 0.2 | Comment |
|---|---|---|---|
| Subject matter, duration, nature, purpose (28(3) intro) | partial | yes | 0.2 adds nature of operations and ties duration to classes |
| Types of data, categories of subjects | yes, inaccurate (IP hash) | yes | IP wording corrected; ARES sole-trader data mentioned |
| Controller's obligations and rights | partial | yes | §8 duties and §5 instruction/audit rights |
| (a) documented instructions, **incl. transfers** | partial, transfers missing | yes | 0.2 §5.1 a) and §6.4 |
| (b) confidentiality of authorised persons | yes | yes | |
| (c) Art. 32 measures | annex partly wrong | yes, annex matches code | TLS shown as a launch condition, not a fact |
| (d) sub-processors: prior authorisation, objection, flow-down, liability (28(2),(4)) | yes, notice only to teacher | yes | notice now to the school contact; 30 days; objection → termination without penalty |
| (e) assistance with data-subject rights | yes | yes | in-app tools listed, response time 10 working days |
| (f) assistance with Arts. 32–36 | yes | yes | adds DPIA-lite input |
| (g) delete or return at end | delete only | yes | export before deletion = return; backups ≤ 60 days |
| (h) information, audits, inspections | yes | yes | |
| (h) 2nd para: tell controller if an instruction infringes law | yes | yes | |
| Art. 33(2) breach notice to controller | "[48]" placeholder | 48 h fixed | from the moment Billanta learns of it; partial information allowed, completed later |
| Art. 28(10) processor using data for own purposes | implied | explicit | |
| Art. 30(2) processor's record of processing | missing | yes | §5.1 j) |
| Art. 28(9) written form, incl. electronic | implied | explicit | §10 |
| Authority requests (e.g. police) | missing | yes | §5.1 i) |

## 3. What a school DPO would object to (in 0.1 and in the product)

Ordered roughly by how hard they would push.

1. **"Smlouvu uzavírá učitel… nic se nepodepisuje."** The DPO's first
   question is who is authorised to bind the school. See section 5.
2. **HTTP in production.** "Šifrovaný přenos (HTTPS / TLS)" in Annex 1 is
   not true today.
3. **"Údaje Žáků se zpracovávají v EU / EHP."** Not true for the server
   (OVH Canada by IP) and not demonstrably true for Google Drive.
4. **Backups: "[30] dní".** Real figure: up to 60 days on Drive, 14 days
   locally. (The general privacy policy says 90; it should say 60.)
5. **IP "otisk se solí platný 24 hodin".** Classroom does not do this.
   Overstating a measure is as bad as understating it in an audit.
6. **Notices go to the teacher, not to the school.** Breach notices and
   sub-processor changes must reach the controller (ředitel / the
   school's official e-mail / datová schránka) and ideally the DPO. The
   application does not collect either.
7. **The teacher can see and print every pupil's re-entry code.** That lets
   a teacher log in as a pupil. Most DPOs will accept it for a practice
   tool (the teacher is the school's own staff and the companies are
   fictional), but they will want it written down and logged.
8. **Real people via ARES.** A pupil who looks up a real IČO of a sole
   trader pulls in that person's name and address. The data is public,
   but the school becomes controller of it in its pupils' companies. A DPO
   will ask that the lesson uses legal entities or invented data.
9. **No pupil-facing notice.** The join page says "Nechceme e-mail ani
   heslo…" but links to no privacy information. Art. 13 duties are on the
   school, but the school needs a template and a link to point to.
10. **Liability placeholder.** A blanket liability cap for a free service
    is fine between the parties, but it must not touch data subjects'
    rights under Art. 82. The 0.2 text says so.
11. **Shared VPS.** The server also runs two unrelated products. A DPO will
    ask who has root, whether SSH is key-only and whether the provider
    console has 2FA. Unknown today, so it is a placeholder in Annex 1.
12. **Teachers have no mandatory 2FA.** A teacher account can read every
    pupil company of the class. Not a blocker for a practice tool, but a
    DPO will ask.

## 4. Legal basis

### 4.1 Czech public school (ZŠ, SŠ)

- **Art. 6(1)(e) GDPR** – task in the public interest: education under
  zákon č. 561/2004 Sb. (školský zákon). Teaching bookkeeping/invoicing is
  part of the school's ŠVP (economics subjects at SŠ, financial literacy
  at ZŠ); the ředitel decides on teaching methods and tools within the
  ŠVP (§ 164 – check). Using an online practice tool is a means of
  delivering that task. Many Czech schools already process pupils' data
  in online tools (Bakaláři, Google Workspace for Education, Microsoft
  365) on this basis.
- **Consent is not needed and should not be used.** Consent in a
  pupil–school relationship is hardly "freely given" (recital 43), and the
  tool is part of the lesson.
- **Art. 8 does not apply.** It only governs consent as the basis for an
  information society service offered *directly* to a child. Here the
  basis is not consent and the service is provided to the school. For
  completeness: the Czech age of digital consent is 15 (§ 7 zákona
  č. 110/2019 Sb.).
- **Private and church schools**: still Art. 6(1)(e) for the education
  task in most readings (they deliver the same statutory education), with
  Art. 6(1)(f) or (b) as fall-backs. Their DPO decides.

### 4.2 Slovak public school

- **Art. 6(1)(e) GDPR** with zákon č. 245/2008 Z. z. (školský zákon),
  education according to the ŠkVP; the riaditeľ is responsible for the
  educational process (zákon č. 596/2003 Z. z., § 5 – check). § 11
  školského zákona regulates school documentation and personal data of
  pupils; this tool is not school documentation, which keeps it simple.
- Consent is not needed. The Slovak age of digital consent is 16 (§ 15
  zákona č. 18/2018 Z. z.), irrelevant here for the same reason as above.
- The GDPR applies directly; zákon č. 18/2018 Z. z. supplements it (DPO
  is "zodpovedná osoba", supervisory authority is Úrad na ochranu
  osobných údajov SR).

### 4.3 Billanta's own processing

Billanta is a **processor** for pupil data and the teacher's use of the
class. For the teacher's own account (login, e-mail, billing of a normal
Billanta account) Billanta remains **controller** under its general
privacy policy. 0.2 keeps that line explicit.

## 5. Can a teacher's click bind the school?

**My view: no, not on its own.**

- A CZ public school is usually a příspěvková organizace. Its statutory
  body is the ředitel. Employees act for it under § 166 občanského zákoníku
  only within what is usual for their position. Teaching with an online
  tool is usual; **concluding a controller–processor contract is not**. It
  defines the school's obligations as a controller and is normally signed
  by the ředitel or an authorised deputy (often after the DPO has seen it).
- A SK public school (rozpočtová / príspevková organizácia or a school
  with legal personality) is represented by the riaditeľ. The same logic
  applies.
- Art. 28(9) accepts electronic form, so a click *can* be the signature.
  It just has to be the click of someone who may bind the school.

**What would work without making schools print anything** (0.2 §1 and §10):

1. The teacher applies as today and names the school's official e-mail
   (or Billanta takes it from the school register) and, optionally, the
   school DPO's e-mail.
2. Billanta sends a confirmation link to the **ředitel / riaditeľ** at the
   school's official e-mail. The ředitel opens the DPA, ticks "jsem
   statutární orgán nebo osoba pověřená" and confirms. Store version,
   timestamp, name, role and e-mail **on `classroom_schools`**.
3. Alternatives for schools that want them: a signed PDF, a qualified
   electronic signature, or a reply from the school's datová schránka /
   slovensko.sk mailbox.
4. Once the school has accepted, its other teachers only state that they
   teach at the school ("jednám v rámci pověření Školy"), which is a usual
   act of an employee.

Until that flow exists, the manual fallback is the PDF route, handled by
the admin who approves the school in `/admin/classroom`.

## 6. DPIA screening (Art. 35, EDPB WP248 rev.01, ÚOOÚ and Úrad SR lists)

Neither the Czech ÚOOÚ list nor the Slovak Úrad list (Art. 35(4) lists)
names "practice software used in class" as such. Screening against the
nine WP248 criteria:

| # | Criterion | Applies? | Why |
|---|---|---|---|
| 1 | Evaluation or scoring | **borderline** | the teacher sees per-pupil progress (counts of documents, last activity). That is observation of school work, not profiling with effects; no automated grading. |
| 2 | Automated decisions with legal or similar effect | no | nothing is decided automatically |
| 3 | Systematic monitoring | no | no tracking beyond the pupil's own practice company; no analytics on `/join` or dashboard |
| 4 | Sensitive or highly personal data | no | nickname and fictional bookkeeping; Art. 9 data are prohibited by contract |
| 5 | Large scale | no | per school: one or a few classes, tens to low hundreds of pupils |
| 6 | Matching or combining datasets | no | ARES lookups return public company data; no combination with other pupil data |
| 7 | Vulnerable data subjects | **yes** | children 11–19 in a subordinate relationship to the school |
| 8 | Innovative technology | no | ordinary web app, AI off |
| 9 | Prevents exercising a right or using a service | no | the lesson can use paper or another tool |

**Conclusion.** One clear criterion (7), one borderline (1). WP248 says
two criteria usually mean a DPIA is needed, but the controller may
document why not. My recommendation as a DPO:

- **A full DPIA is likely not mandatory** (small scale, minimal data, no
  names, no profiling, no automated decisions, short retention).
- **Write the screening down** (this table is enough) and keep it with the
  school's records of processing.
- Billanta should offer a **pre-filled DPIA-lite** (description, necessity,
  risks, measures) so a cautious DPO can do one in 30 minutes. The risks
  worth listing: nickname reveals identity; teacher impersonation via
  codes; a pupil enters real personal data; breach at the hosting
  provider; backup copy abroad.

## 7. Sub-processors, transfers and backups

### 7.1 Who touches pupil data

| Recipient | Role | Pupil data? | Location | Status |
|---|---|---|---|---|
| VPS provider (IP owned by **OVH Hosting, Inc.**, Montreal) | hosting, DB | yes | **Canada** (likely Beauharnois DC) by RDAP | contracting entity and DC unverified; DPA with OVH must be in place |
| Google (Drive) | encrypted backup storage | yes (ciphertext) | worldwide incl. US unless Workspace data regions | account type unknown |
| Resend | e-mails to teachers | no | US by default; EU sending region exists | region unverified |
| Google (Sign-in) | teacher login, optional | no | US/global | |
| Cloudflare | planned CDN/TLS | yes once enabled (terminates TLS) | global | not yet live; 30-day notice needed when added |
| Microsoft Clarity | marketing pages only | no | US | not on `/join` or dashboard; must stay that way |

### 7.2 Hosting in Canada

Canada has a (partial) adequacy decision (2002/2/EC, confirmed in the
2024 review) that covers commercial organisations under PIPEDA. OVH
Hosting, Inc. is such an organisation, so **hosting in Canada is a lawful
transfer under Art. 45**. The problem is not legality but accuracy: the
privacy policy and draft 0.1 say "EU". Two options:

- **Move the VPS to an OVH EU region** (Gravelines/Roubaix/Strasbourg FR,
  Frankfurt DE, Warsaw PL). Strongly preferred for schools: DPOs and
  zřizovatelé often have an "EU only" rule for pupil data.
- Or state "Kanada (rozhodnutí o odpovídající ochraně)" in Annex 2 and the
  privacy policy. Legal, but expect pushback.

Also confirm which OVH entity is the contracting party (OVH SAS vs OVH
Hosting, Inc.) and that its DPA is accepted.

### 7.3 Google Drive backup: is it an Art. 44 transfer?

- **Consumer Google account**: Google acts as controller under its own
  consumer terms and offers no Art. 28 DPA. It **cannot** be a proper
  sub-processor for school data. If that is what is used today, it is a
  blocking item.
- **Google Workspace** (business): the Cloud Data Processing Addendum makes
  Google a processor; the contracting entity for EEA customers is Google
  Ireland / Google Cloud EMEA, and Google LLC is DPF-certified (Decision
  (EU) 2023/1795) with SCCs as a fall-back. Data regions (pinning Drive
  content to the EU) exist only in some editions (Business Standard and
  above, Enterprise). Without data regions, files may sit in the US.
- **Is it a transfer?** Yes, if the files can be stored outside the EEA.
  Encryption does not make the transfer disappear in the EDPB's view, but
  **age encryption with the private key held offline in the EEA** is the
  textbook effective supplementary measure (EDPB Recommendations 01/2020,
  use case 1: storage for backup). The CJEU judgment C-413/23 P (EDPS v
  SRB, 2025) supports the argument that data the recipient cannot
  re-identify may not be personal data *for that recipient*, but I would
  use it only as a supporting point, not as the basis.
- **Condition**: `BACKUP_AGE_RECIPIENT` must be set in production. Without
  it `maintenance.sh` writes a plain dump and keeps it locally only, so
  nothing leaves for Drive, but then there is no off-site backup at all.
  Verify on the server (do not print the value).

**Recommendation**: Workspace with the Cloud DPA and EU data region, or
(better and cheaper) an EU object store (OVH Object Storage in FR/DE,
Hetzner Storage Box, Backblaze EU) with the same `age` encryption. Either
way, Annex 2 says what is true.

### 7.4 The unused dev sidecar

`apps/backup` (unencrypted gzip to Drive, 30 days) runs only in the root
dev `docker-compose.yml`, not in production. Keep it that way; a DPO who
reads the repo will ask.

## 8. Retention and pupils' rights

### 8.1 Retention

| Data | Kept | Then |
|---|---|---|
| Pupil company and nickname | while the class runs (default end 31 August, at most 13 months ahead; the teacher can extend repeatedly, each time by at most 13 months) | read-only 30 days after the end, then deleted by cron |
| Removed pupil | | deleted immediately |
| Sessions | max 14 days, never past deletion | |
| In-memory rate-limit keys (IP) | about 10 minutes | gone on restart |
| Local DB dumps | 14 days | rotated |
| Off-site backups | 60 days | pruned |
| Container logs | rotated by size (3 × 10 MB) | |
| Teacher account | per the general privacy policy | |

The general privacy policy says backups are purged within 90 days; real
value is 60. The 0.2 DPA says 60.

### 8.2 Pupils' rights and how they are met

| Right | How | Gap |
|---|---|---|
| Information (Art. 13) | school's duty; Billanta gives Annex 3 template | no link from `/join` yet (**blocking**) |
| Access (15) | pupil sees everything in their own company; teacher can export documents and the progress CSV | no per-pupil "all my data" export; acceptable for this data |
| Rectification (16) | pupil edits own records | **nickname cannot be changed**; workaround: remove and rejoin. Nice to have. |
| Erasure (17) | teacher removes pupil → immediate delete | backups up to 60 days, stated |
| Restriction (18) | via Billanta support | rare; fine |
| Objection (21) | applies to Art. 6(1)(e); school decides, then removal | |
| Portability (20) | does not apply to Art. 6(1)(e) | |

### 8.3 Pupil notice

Annex 3 of the 0.2 DPA is a short template for pupils and parents (CZ and
SK versions). It should be published on a public page and linked from the
join screen (frontend change, not done here because other agents are
editing the frontend).

## 9. Ranked list

### Blocking before launch

1. **TLS in production.** Serve over HTTPS on a real domain before any
   pupil joins. (If Cloudflare terminates TLS, add it to Annex 2 first.)
2. **Fill in the operator identity** (name, IČO, seat, register entry,
   contact and incident e-mail). Without a counterparty there is no
   contract.
3. **Statutory representative accepts, not the teacher.** Implement the
   ředitel/riaditeľ confirmation (section 5) or a PDF fallback; store
   acceptance on the school; collect the school's official e-mail and the
   DPO's e-mail; send breach and sub-processor notices there.
4. **Link the school DPA, not the general DPA, and version it.** The apply
   form links `/legal/dpa` and says "Nic se nepodepisuje"; the code
   constant still says `classroom-dpa-0.1`. Publish 0.2 (after DPO
   feedback) as its own page, and bump the version.
5. **Hosting location: move to an OVH EU region or state Canada
   truthfully** in the DPA, Annex 2 and the privacy policy; confirm the OVH
   DPA.
6. **Backups: no consumer Google account.** Workspace with the Cloud DPA
   (ideally EU data region) or an EU object store; confirm
   `BACKUP_AGE_RECIPIENT` is set in production and the key is held offline
   in the EU.
7. **Pupil notice live and linked from `/join`** (Annex 3 text, CZ/SK/EN).
8. **Align the general privacy policy** with reality (backup 60 days,
   hosting location, sub-processor list URL).

### Nice to have (in rough order)

1. Offer the pre-filled DPIA-lite and the processor's Art. 30(2) record as
   downloadable documents for school DPOs.
2. Log every time a teacher reveals or prints pupil codes (tenant audit
   log), and say so in Annex 1; or show codes only once and let the
   teacher regenerate instead.
3. Require or strongly nudge 2FA for teachers who own a class.
4. Let the teacher correct a nickname (Art. 16) without deleting the
   company.
5. Warn pupils in ARES lookups that real sole traders are real people, or
   limit classroom lookups to legal entities.
6. Move `classroom_students` access behind SECURITY DEFINER functions as
   the plan intended (today `faktur_app` can read and update it).
7. Document operator access to production: SSH keys only, provider console
   2FA, who has root on the shared VPS; longer-term, a separate VPS or at
   least separate Unix users for the other products.
8. Public sub-processor page with an RSS/e-mail subscription for changes.
9. A short "for the DPO" one-pager linked from the school landing page.

## 10. Questions for a real school DPO

1. Is a ředitel's confirmation by click from the school's official e-mail
   enough for you, or do you need a signed PDF / qualified e-signature /
   datová schránka?
2. Do you accept Art. 6(1)(e) + the školský zákon as the basis, with no
   parental consent, for pupils from 11 years?
3. Would you require a DPIA, or is the written screening plus a DPIA-lite
   enough?
4. Is hosting in Canada (adequacy decision) acceptable to you and to your
   zřizovatel, or is "EU only" a hard rule?
5. Is an encrypted backup on Google Workspace (key held offline in the EU)
   acceptable, or must backups be in the EU as well?
6. Is the 60-day backup tail after deletion acceptable?
7. Is it acceptable that teachers can see pupils' re-entry codes (and so
   could log in as them) if it is logged?
8. Do you want breach notices to go to the ředitel, to you, or both? Is 48
   hours from discovery, with partial information first, acceptable?
9. Would your zřizovatel (obec, kraj, ministerstvo) insist on its own DPA
   template?
10. (SK) Is a free DPA a "povinne zverejňovaná zmluva" under § 5a zákona
    č. 211/2000 Z. z., so that it only takes effect after publication in
    the Centrálny register zmlúv? (CZ: registr smluv applies only above
    50 000 Kč, so a free contract should be out of scope; please confirm.)
11. Is the nickname rule ("no full name") enough, or do you want
    nicknames generated by the system?
12. What would you need from us to put this tool into your record of
    processing activities (Art. 30)?
13. Do you see the progress view as "evaluation" in the WP248 sense?
14. Would you accept a liability clause that limits the processor's
    liability to the school (not to pupils) for a free service?

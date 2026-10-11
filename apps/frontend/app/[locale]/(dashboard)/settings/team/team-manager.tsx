'use client';

import { useState, useTransition } from 'react';
import { Copy, Loader2, Mail, SlidersHorizontal, Trash2, UserPlus, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass, Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { formatDate } from '@/lib/invoice-ui';
import { cn } from '@/lib/utils';
import { PERMISSION_AREAS, type PermissionLevel } from '@/lib/access';
import { effective, presetOf, TEAM_PRESETS, toAssignment, type Perms } from '@/lib/team-presets';
import { changeMemberRole, inviteMember, removeMember, revokeInvitation, type MemberPermissions, type TeamRole } from '../actions';

export interface TeamData {
  members: {
    id: string;
    userId: string;
    email: string;
    name: string | null;
    image: string | null;
    role: TeamRole;
    permissions?: Partial<Perms> | null;
    createdAt: string;
  }[];
  invitations: {
    id: string;
    email: string;
    role: TeamRole;
    permissions?: Partial<Perms> | null;
    expiresAt: string;
    createdAt: string;
    expired: boolean;
  }[];
}

type AssignableRole = Exclude<TeamRole, 'owner'>;
const LEVELS: PermissionLevel[] = ['none', 'read', 'write'];
const LEVEL_CLASSES: Record<PermissionLevel, string> = {
  none: 'text-muted-foreground line-through',
  read: 'text-foreground',
  write: 'text-success font-semibold'
};

/** What to send for a chosen preset or custom levels. */
function assignmentFor(preset: string, perms: Perms): { role: AssignableRole; permissions: MemberPermissions } {
  const p = TEAM_PRESETS.find((x) => x.key === preset);
  if (p?.role === 'admin') return { role: 'admin', permissions: null };
  return toAssignment(p ? p.perms : perms);
}

/** Area × level matrix for custom access. */
function PermissionGrid({ value, onChange, disabled }: { value: Perms; onChange: (next: Perms) => void; disabled?: boolean }) {
  const t = useTranslations('settings.team');
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{t('areas.title')}</th>
            {LEVELS.map((l) => (
              <th key={l} className="px-2 py-2 text-center font-medium">
                {t(`levels.${l}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {PERMISSION_AREAS.map((area) => (
            <tr key={area}>
              <td className="px-3 py-2 font-medium">{t(`areas.${area}`)}</td>
              {LEVELS.map((l) => (
                <td key={l} className="px-2 py-2 text-center">
                  <input
                    type="radio"
                    name={`perm-${area}`}
                    aria-label={`${t(`areas.${area}`)}: ${t(`levels.${l}`)}`}
                    className="accent-primary"
                    checked={value[area] === l}
                    disabled={disabled}
                    onChange={() => onChange({ ...value, [area]: l })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One-line summary of a non-admin's access: struck through = none, bold ✎ = edit. */
function AccessSummary({ role, permissions }: { role: TeamRole; permissions?: Partial<Perms> | null }) {
  const t = useTranslations('settings.team');
  if (role === 'owner' || role === 'admin') return null;
  const perms = effective(role, permissions);
  return (
    <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
      {PERMISSION_AREAS.map((a) => (
        <span key={a} className={LEVEL_CLASSES[perms[a]]} title={t(`levels.${perms[a]}`)}>
          {t(`areas.${a}`)}
          {perms[a] === 'write' ? ' ✎' : ''}
        </span>
      ))}
    </p>
  );
}

const ROLE_CLASSES: Record<TeamRole, string> = {
  owner: 'bg-primary/15 text-primary',
  admin: 'bg-warning/15 text-warning',
  accountant: 'bg-success/15 text-success',
  viewer: 'bg-muted text-muted-foreground'
};

export function TeamManager({ team, canManage, currentUserId }: { team: TeamData; canManage: boolean; currentUserId: string }) {
  const t = useTranslations('settings.team');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [preset, setPreset] = useState('accountant');
  const [customPerms, setCustomPerms] = useState<Perms>(effective('accountant', null));
  const [editing, setEditing] = useState<{ id: string; name: string; perms: Perms } | null>(null);
  const [createdLink, setCreatedLink] = useState<{ url: string; emailSent: boolean } | null>(null);
  const [removing, setRemoving] = useState<TeamData['members'][number] | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      toast(result.ok ? { text: done, tone: 'ok' } : { text: `${t('failed')}: ${result.error}`, tone: 'err' });
      if (result.ok) after?.();
      router.refresh();
    });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ text: t('copied'), tone: 'ok' });
    } catch {
      toast({ text: text, tone: 'info' });
    }
  };

  const sendInvite = () =>
    startTransition(async () => {
      const { role, permissions } = assignmentFor(preset, customPerms);
      const result = await inviteMember(email.trim(), role, permissions);
      if (!result.ok) {
        toast({ text: `${t('failed')}: ${result.error}`, tone: 'err' });
        return;
      }
      setCreatedLink({ url: result.data.acceptUrl, emailSent: result.data.emailSent });
      setEmail('');
      router.refresh();
    });

  const pendingInvites = team.invitations;

  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-bold">{t('members', { count: team.members.length })}</h2>
            <p className="text-xs text-muted-foreground">{t('membersHint')}</p>
          </div>
          {canManage && (
            <button
              type="button"
              className={buttonClass.primary}
              onClick={() => {
                setCreatedLink(null);
                setInviteOpen(true);
              }}
            >
              <UserPlus className="h-4 w-4" />
              {t('invite')}
            </button>
          )}
        </div>
        <ul className="divide-y divide-border">
          {team.members.map((m) => {
            const isMe = m.userId === currentUserId;
            const editable = canManage && m.role !== 'owner' && !isMe;
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                  {(m.name || m.email).charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {m.name || m.email}
                    {isMe && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({t('you')})</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.email} · {t('since', { date: formatDate(m.createdAt, locale) ?? '' })}
                  </p>
                  <AccessSummary role={m.role} permissions={m.permissions} />
                </div>
                {editable ? (
                  <>
                    <select
                      aria-label={t('role')}
                      className={cn(inputClass, 'w-auto py-1.5')}
                      value={presetOf(m.role, m.permissions)}
                      disabled={pending}
                      onChange={(e) => {
                        const key = e.target.value;
                        const current = effective(m.role, m.permissions);
                        if (key === 'custom') {
                          setEditing({ id: m.id, name: m.name || m.email, perms: current });
                          return;
                        }
                        const { role, permissions } = assignmentFor(key, current);
                        run(() => changeMemberRole(m.id, role, permissions), t('roleChanged'));
                      }}
                    >
                      {TEAM_PRESETS.map((p) => (
                        <option key={p.key} value={p.key}>
                          {t(`presets.${p.key}`)}
                        </option>
                      ))}
                      <option value="custom">{t('presets.custom')}</option>
                    </select>
                    {m.role !== 'admin' && (
                      <button
                        type="button"
                        className={buttonClass.ghost}
                        aria-label={t('editPermissions')}
                        title={t('editPermissions')}
                        onClick={() => setEditing({ id: m.id, name: m.name || m.email, perms: effective(m.role, m.permissions) })}
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                      </button>
                    )}
                  </>
                ) : (
                  <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', ROLE_CLASSES[m.role])}>
                    {m.role === 'owner' ? t('roles.owner') : t(`presets.${presetOf(m.role, m.permissions)}`)}
                  </span>
                )}
                {editable && (
                  <button type="button" className={buttonClass.ghost} aria-label={t('remove')} onClick={() => setRemoving(m)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {pendingInvites.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border p-4 font-bold">{t('invitations', { count: pendingInvites.length })}</h2>
          <ul className="divide-y divide-border">
            {pendingInvites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                  <Mail className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{inv.email}</p>
                  <p className={cn('text-xs', inv.expired ? 'text-destructive' : 'text-muted-foreground')}>
                    {inv.expired ? t('expired') : t('expires', { date: formatDate(inv.expiresAt, locale) ?? '' })}
                  </p>
                  <AccessSummary role={inv.role} permissions={inv.permissions} />
                </div>
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', ROLE_CLASSES[inv.role])}>
                  {t(`presets.${presetOf(inv.role, inv.permissions)}`)}
                </span>
                {canManage && (
                  <button
                    type="button"
                    className={buttonClass.ghost}
                    disabled={pending}
                    onClick={() => run(() => revokeInvitation(inv.id), t('revoked'))}
                  >
                    <X className="h-4 w-4" />
                    {t('revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-bold">{t('rolesTitle')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('presetsHint')}</p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-muted/40 p-3">
            <dt>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', ROLE_CLASSES.owner)}>{t('roles.owner')}</span>
            </dt>
            <dd className="mt-1.5 text-xs text-muted-foreground">{t('roleHints.owner')}</dd>
          </div>
          {TEAM_PRESETS.map((p) => (
            <div key={p.key} className="rounded-lg bg-muted/40 p-3">
              <dt>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', ROLE_CLASSES[p.role])}>{t(`presets.${p.key}`)}</span>
              </dt>
              <dd className="mt-1.5 text-xs text-muted-foreground">{t(`presetHints.${p.key}`)}</dd>
              {p.role !== 'admin' && <AccessSummary role={p.role} permissions={p.perms} />}
            </div>
          ))}
        </dl>
      </section>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('inviteTitle')}
        footer={
          createdLink ? (
            <button type="button" className={buttonClass.primary} onClick={() => setInviteOpen(false)}>
              {t('done')}
            </button>
          ) : (
            <>
              <button type="button" className={buttonClass.secondary} onClick={() => setInviteOpen(false)}>
                {t('cancel')}
              </button>
              <button type="button" className={buttonClass.primary} disabled={pending || !email.includes('@')} onClick={sendInvite}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {t('sendInvite')}
              </button>
            </>
          )
        }
      >
        {createdLink ? (
          <div className="space-y-3">
            <p>{createdLink.emailSent ? t('inviteSent') : t('inviteNotSent')}</p>
            <div className="flex gap-2">
              <input className={cn(inputClass, 'font-mono text-xs')} readOnly value={createdLink.url} onFocus={(e) => e.target.select()} />
              <button type="button" className={buttonClass.secondary} onClick={() => copy(createdLink.url)}>
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block font-medium">{t('email')}</span>
              <input type="email" className={inputClass} value={email} autoFocus onChange={(e) => setEmail(e.target.value)} placeholder="ucetni@example.cz" />
            </label>
            <fieldset>
              <legend className="mb-1.5 font-medium">{t('role')}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {[...TEAM_PRESETS.map((p) => p.key), 'custom'].map((key) => (
                  <label
                    key={key}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5',
                      preset === key ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'
                    )}
                  >
                    <input
                      type="radio"
                      name="preset"
                      className="mt-0.5 accent-primary"
                      checked={preset === key}
                      onChange={() => {
                        setPreset(key);
                        const p = TEAM_PRESETS.find((x) => x.key === key);
                        if (p && p.role !== 'admin') setCustomPerms(p.perms);
                      }}
                    />
                    <span>
                      <span className="block font-semibold">{t(`presets.${key}`)}</span>
                      <span className="block text-xs text-muted-foreground">{t(`presetHints.${key}`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {preset === 'custom' && <PermissionGrid value={customPerms} onChange={setCustomPerms} />}
          </div>
        )}
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? t('editPermissionsFor', { name: editing.name }) : ''}
        footer={
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setEditing(null)}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className={buttonClass.primary}
              disabled={pending}
              onClick={() => {
                if (!editing) return;
                const { role, permissions } = toAssignment(editing.perms);
                run(() => changeMemberRole(editing.id, role, permissions), t('roleChanged'), () => setEditing(null));
              }}
            >
              {t('save')}
            </button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('permissionsHint')}</p>
            <PermissionGrid value={editing.perms} onChange={(perms) => setEditing({ ...editing, perms })} disabled={pending} />
          </div>
        )}
      </Modal>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('removeTitle')}
        footer={
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setRemoving(null)}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className={buttonClass.danger}
              disabled={pending}
              onClick={() => removing && run(() => removeMember(removing.id), t('removed'), () => setRemoving(null))}
            >
              {t('remove')}
            </button>
          </>
        }
      >
        {removing && t('removeBody', { name: removing.name || removing.email })}
      </Modal>
    </div>
  );
}

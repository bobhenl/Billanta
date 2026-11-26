'use client';

import { Fragment, useState, useTransition, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Copy, Loader2, Lock, Mail, SlidersHorizontal, Trash2, UserPlus, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass, Modal } from '@/components/modal';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { formatDate } from '@/lib/invoice-ui';
import { cn } from '@/lib/utils';
import { PERMISSION_ACTIONS, PERMISSION_AREAS, type PermissionArea, type PermissionLevel } from '@/lib/access';
import {
  allowedActions,
  AREA_ACTIONS,
  effective,
  presetOf,
  sameAccess,
  TEAM_PRESETS,
  toAssignment,
  type Access,
  type StoredPerms
} from '@/lib/team-presets';
import { changeMemberRole, inviteMember, removeMember, revokeInvitation, type MemberPermissions, type TeamRole } from '../actions';
import { copyText } from '@/lib/clipboard';
import type { PublicAccountant } from '@/lib/accountant-directory';
import { AccountantPicker } from './accountant-picker';

export interface TeamData {
  members: {
    id: string;
    userId: string;
    email: string;
    name: string | null;
    image: string | null;
    role: TeamRole;
    permissions?: StoredPerms | null;
    createdAt: string;
  }[];
  invitations: {
    id: string;
    email: string;
    role: TeamRole;
    permissions?: StoredPerms | null;
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

/** What to send for a chosen preset or a custom access. */
function assignmentFor(preset: string, access: Access): { role: AssignableRole; permissions: MemberPermissions } {
  const p = TEAM_PRESETS.find((x) => x.key === preset);
  if (p?.role === 'admin') return { role: 'admin', permissions: null };
  return toAssignment(p ? p.access : access);
}

/** The non-admin preset an access matches, or 'custom' (the dialog's preset follows the ticks). */
const presetKeyOf = (access: Access) => TEAM_PRESETS.find((p) => p.role !== 'admin' && sameAccess(p.access, access))?.key ?? 'custom';

const reaches = (have: PermissionLevel, need: 'read' | 'write') => (need === 'read' ? have !== 'none' : have === 'write');

/** Settings only splits into sections: its pages are open to read for everyone, so "none" means nothing there. */
const levelsOf = (area: PermissionArea): PermissionLevel[] => (area === 'settings' ? ['read', 'write'] : LEVELS);

/**
 * Which clients a member sees ("Klienti: celá firma / jen přiřazení",
 * `tenant_memberships.contact_scope`) will be a row right under Kontakty,
 * passed in here. Empty until that lands.
 */
const CONTACT_SCOPE_ROW: Partial<Record<PermissionArea, ReactNode>> | undefined = undefined;

/** Settings pages that are never handed out: shown locked so the owner sees why they are missing. */
const LOCKED_SETTINGS = ['backup', 'billing'] as const;

/**
 * Area × level matrix. Each area with finer actions has a chevron that
 * opens them as checkboxes; a box is greyed out while the area level is too
 * low for it. Ticking a settings section raises settings to "Úpravy", the
 * only level at which sections apply.
 */
function PermissionGrid({
  value,
  onChange,
  disabled,
  extraRows
}: {
  value: Access;
  onChange: (next: Access) => void;
  disabled?: boolean;
  /** Rows to show right after an area's row (e.g. which clients a member sees, after contacts). */
  extraRows?: Partial<Record<PermissionArea, ReactNode>>;
}) {
  const t = useTranslations('settings.team');
  const [open, setOpen] = useState<Set<PermissionArea>>(new Set());
  const allowed = allowedActions(value);
  const toggleOpen = (area: PermissionArea) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-2 py-2 text-left font-medium sm:px-3">{t('areas.title')}</th>
            {LEVELS.map((l) => (
              <th key={l} className="w-14 px-1 py-2 text-center font-medium sm:w-20 sm:px-2">
                {t(`levels.${l}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {PERMISSION_AREAS.map((area) => {
            const actions = AREA_ACTIONS[area];
            const expanded = open.has(area);
            const granted = actions.filter((a) => allowed[a]).length;
            const usable = actions.filter((a) => area === 'settings' || reaches(value.levels[area], PERMISSION_ACTIONS[a])).length;
            return (
              <Fragment key={area}>
                <tr>
                  <td className="px-2 py-1.5 sm:px-3">
                    {actions.length > 0 ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={`perm-actions-${area}`}
                        onClick={() => toggleOpen(area)}
                        className="-ml-1 flex items-center gap-1 rounded px-1 py-0.5 text-left font-medium hover:text-primary"
                      >
                        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
                        <span>{t(`areas.${area}`)}</span>
                        {usable > 0 && (
                          <span className={cn('text-[11px] font-normal tabular-nums', granted < usable && area !== 'settings' ? 'text-warning' : 'text-muted-foreground')}>
                            {t('actionsCount', { granted, total: usable })}
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="pl-5 font-medium">{t(`areas.${area}`)}</span>
                    )}
                  </td>
                  {LEVELS.map((l) => (
                    <td key={l} className="px-1 py-1.5 text-center sm:px-2">
                      {levelsOf(area).includes(l) ? (
                        <input
                          type="radio"
                          name={`perm-${area}`}
                          aria-label={`${t(`areas.${area}`)}: ${t(`levels.${l}`)}`}
                          className="accent-primary"
                          checked={value.levels[area] === l}
                          disabled={disabled}
                          onChange={() => onChange({ ...value, levels: { ...value.levels, [area]: l } })}
                        />
                      ) : (
                        <span aria-hidden className="text-muted-foreground">
                          –
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
                {expanded && (
                  <tr id={`perm-actions-${area}`} className="bg-muted/20">
                    <td colSpan={LEVELS.length + 1} className="px-2 pb-2.5 pt-1 sm:px-3">
                      <div className="grid gap-x-4 gap-y-1.5 pl-5 sm:grid-cols-2">
                        {actions.map((a) => {
                          // Sections lift settings to "write" themselves; other areas need the level set first.
                          const usable = area === 'settings' || reaches(value.levels[area], PERMISSION_ACTIONS[a]);
                          return (
                            <label key={a} className={cn('flex items-start gap-2 text-[13px]', !usable && 'text-muted-foreground')}>
                              <input
                                type="checkbox"
                                className="mt-0.5 accent-primary"
                                checked={allowed[a]}
                                disabled={disabled || !usable}
                                onChange={(e) => {
                                  const flags = { ...value.flags, [a]: e.target.checked };
                                  const levels = area === 'settings' && e.target.checked ? { ...value.levels, settings: 'write' as const } : value.levels;
                                  onChange({ levels, flags });
                                }}
                              />
                              <span>
                                {t(`actions.${a}`)}
                                {a === 'settings.apiKeys' && <span className="block text-[11px] text-warning">{t('actionHints.apiKeys')}</span>}
                              </span>
                            </label>
                          );
                        })}
                        {area === 'settings' &&
                          LOCKED_SETTINGS.map((key) => (
                            <span key={key} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>
                                {t(`locked.${key}`)}
                                <span className="block text-[11px]">{t(key === 'backup' ? 'locked.ownerOnly' : 'locked.adminsOnly')}</span>
                              </span>
                            </span>
                          ))}
                      </div>
                    </td>
                  </tr>
                )}
                {extraRows?.[area]}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One-line summary of a non-admin's access: struck through = none, ✎ =
 * edit, a count when only some of the area's actions are allowed. Settings
 * shows up only once a section is granted (reading them is open to all).
 */
function AccessSummary({ role, permissions }: { role: TeamRole; permissions?: StoredPerms | null }) {
  const t = useTranslations('settings.team');
  if (role === 'owner' || role === 'admin') return null;
  const access = effective(role, permissions);
  const allowed = allowedActions(access);
  return (
    <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
      {PERMISSION_AREAS.map((a) => {
        const level = access.levels[a];
        const actions = AREA_ACTIONS[a];
        const granted = actions.filter((x) => allowed[x]);
        if (a === 'settings') {
          if (granted.length === 0) return null;
          return (
            <span key={a} className={LEVEL_CLASSES.write} title={granted.map((x) => t(`actions.${x}`)).join(', ')}>
              {t('areas.settings')} ✎ {t('actionsCount', { granted: granted.length, total: actions.length })}
            </span>
          );
        }
        // Only what the level would allow counts as missing: a read-only area isn't "partial" for lacking write actions.
        const missing = actions.filter((x) => !allowed[x] && reaches(level, PERMISSION_ACTIONS[x]));
        const usable = actions.filter((x) => reaches(level, PERMISSION_ACTIONS[x]));
        return (
          <span
            key={a}
            className={LEVEL_CLASSES[level]}
            title={missing.length ? `${t(`levels.${level}`)} · ${t('summaryWithout', { list: missing.map((x) => t(`actions.${x}`)).join(', ') })}` : t(`levels.${level}`)}
          >
            {t(`areas.${a}`)}
            {level === 'write' ? ' ✎' : ''}
            {missing.length ? ` ${t('actionsCount', { granted: usable.length - missing.length, total: usable.length })}` : ''}
          </span>
        );
      })}
    </p>
  );
}

const ROLE_CLASSES: Record<TeamRole, string> = {
  owner: 'bg-primary/15 text-primary',
  admin: 'bg-warning/15 text-warning',
  accountant: 'bg-success/15 text-success',
  viewer: 'bg-muted text-muted-foreground'
};

/** Presets an outside accountant or tax advisor would be invited with: these offer the directory. */
const DIRECTORY_PRESETS = new Set(['accountant', 'auditor']);

export function TeamManager({
  team,
  canManage,
  currentUserId,
  accountants
}: {
  team: TeamData;
  canManage: boolean;
  currentUserId: string;
  accountants: PublicAccountant[];
}) {
  const t = useTranslations('settings.team');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [preset, setPreset] = useState('accountant');
  const [customAccess, setCustomAccess] = useState<Access>(effective('accountant', null));
  const [editing, setEditing] = useState<{ id: string; name: string; access: Access } | null>(null);
  const [createdLink, setCreatedLink] = useState<{ url: string; emailSent: boolean } | null>(null);
  const [removing, setRemoving] = useState<TeamData['members'][number] | null>(null);

  // The plan's seat limit gets a sentence of its own; other codes stay as they are.
  const failText = (error?: string) => (error?.includes('seat_limit') ? t('seatLimit') : `${t('failed')}: ${error}`);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      toast(result.ok ? { text: done, tone: 'ok' } : { text: failText(result.error), tone: 'err' });
      if (result.ok) after?.();
      router.refresh();
    });

  const copy = async (text: string) => {
    try {
      await copyText(text);
      toast({ text: t('copied'), tone: 'ok' });
    } catch {
      toast({ text: text, tone: 'info' });
    }
  };

  const sendInvite = () =>
    startTransition(async () => {
      const { role, permissions } = assignmentFor(preset, customAccess);
      const result = await inviteMember(email.trim(), role, permissions);
      if (!result.ok) {
        toast({ text: failText(result.error), tone: 'err' });
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
          <InfoHint hint={t('membersHint')} className="min-w-0">
            <h2 className="font-bold">{t('members', { count: team.members.length })}</h2>
          </InfoHint>
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
                  <p className="break-all text-xs text-muted-foreground">
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
                          setEditing({ id: m.id, name: m.name || m.email, access: current });
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
                        onClick={() => setEditing({ id: m.id, name: m.name || m.email, access: effective(m.role, m.permissions) })}
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
                  <button type="button" className={buttonClass.ghost} title={t('remove')} aria-label={t('remove')} onClick={() => setRemoving(m)}>
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
                  <p className="break-all font-semibold">{inv.email}</p>
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
                    title={t('revoke')}
                    aria-label={t('revoke')}
                    onClick={() => run(() => revokeInvitation(inv.id), t('revoked'))}
                  >
                    <X className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('revoke')}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Reference, not a task: the invite dialog already explains each profile. */}
      <details className="group rounded-xl border border-border bg-card p-4 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold [&::-webkit-details-marker]:hidden">
          {t('rolesTitle')}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">{t('presetsHint')}</p>
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
              {p.role !== 'admin' && <AccessSummary role={p.role} permissions={toAssignment(p.access).permissions} />}
            </div>
          ))}
        </dl>
      </details>

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
            {createdLink.emailSent ? (
              <p>{t('inviteSent')}</p>
            ) : (
              <p role="alert" className="font-medium text-warning">{t('inviteNotSent')}</p>
            )}
            <div className="flex gap-2">
              <input className={cn(inputClass, 'min-w-0 flex-1 font-mono text-xs')} readOnly aria-label={t('copyLink')} value={createdLink.url} onFocus={(e) => e.target.select()} />
              <button type="button" className={cn(buttonClass.secondary, 'shrink-0')} title={t('copyLink')} aria-label={t('copyLink')} onClick={() => copy(createdLink.url)}>
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
                        if (p && p.role !== 'admin') setCustomAccess(p.access);
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
            {/* A preset fills the grid; changing a tick turns it into "custom" unless it lands on another preset. */}
            {preset !== 'admin' && (
              <PermissionGrid
                value={customAccess}
                onChange={(next) => {
                  setCustomAccess(next);
                  setPreset(presetKeyOf(next));
                }}
                extraRows={CONTACT_SCOPE_ROW}
              />
            )}
            {DIRECTORY_PRESETS.has(preset) && (
              <AccountantPicker
                accountants={accountants}
                onPick={(picked) => {
                  setEmail(picked);
                  toast({ text: t('directory.picked', { email: picked }), tone: 'info' });
                }}
              />
            )}
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
                const { role, permissions } = toAssignment(editing.access);
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
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{t('fillFromPreset')}</span>
              <select
                className={cn(inputClass, 'w-auto py-1.5')}
                value={presetKeyOf(editing.access)}
                disabled={pending}
                onChange={(e) => {
                  const p = TEAM_PRESETS.find((x) => x.key === e.target.value);
                  if (p) setEditing({ ...editing, access: p.access });
                }}
              >
                {TEAM_PRESETS.filter((p) => p.role !== 'admin').map((p) => (
                  <option key={p.key} value={p.key}>
                    {t(`presets.${p.key}`)}
                  </option>
                ))}
                <option value="custom" disabled>
                  {t('presets.custom')}
                </option>
              </select>
            </label>
            <PermissionGrid
              value={editing.access}
              onChange={(access) => setEditing({ ...editing, access })}
              disabled={pending}
              extraRows={CONTACT_SCOPE_ROW}
            />
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

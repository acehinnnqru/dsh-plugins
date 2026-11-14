/**
 * Board settings dialog: the Recent-window preference plus the live network
 * fields the Host projects from this plugin's Config schema.
 * @module dsh-plugin-session-manager/client/settings-dialog
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Input, Modal, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import { RECENT_WINDOW_DAYS } from './board.ts'
import { EMPTY_SETTINGS, type SessionManagerSettings } from './settings.ts'
import type { Translate } from './session-view.ts'
import css from './SessionBoard.module.css'

/** Settings dialog props. */
interface SettingsDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly form: ConfigForm<SessionManagerSettings> | undefined
  readonly saveSettings: (
    section: SessionManagerSettings,
    revision: number | undefined,
  ) => Promise<{ readonly ok: boolean; readonly message?: string }>
  readonly windowDays: number
  readonly onWindowDays: (days: number) => void
  readonly t: Translate
}

/** Editable text state. */
interface Draft {
  server: string
  token: string
  name: string
}

/** Build the draft from one Host section. */
function draftOf(value: SessionManagerSettings): Draft {
  return {
    server: value.server ?? '',
    token: value.token ?? '',
    name: value.name ?? '',
  }
}

/**
 * Render the settings dialog.
 * @param props - open state, Host form, recent-window preference, and copy.
 * @returns the modal, or nothing while closed.
 */
export function SettingsDialog(props: SettingsDialogProps): ReactNode {
  const { open, onClose, form, saveSettings, windowDays, onWindowDays, t } = props
  const [snapshot, setSnapshot] = useState<ConfigFormSnapshot<SessionManagerSettings> | undefined>(
    form?.getSnapshot(),
  )
  const [draft, setDraft] = useState<Draft>(() => draftOf(EMPTY_SETTINGS))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'failed'>('idle')
  const [saveError, setSaveError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (form === undefined) {
      setSnapshot(undefined)
      return
    }
    setSnapshot(form.getSnapshot())
    return form.subscribe(() => {
      setSnapshot(form.getSnapshot())
    })
  }, [form])

  useEffect(() => {
    setSaveStatus('idle')
    setSaveError(undefined)
    if (!open) setDirty(false)
  }, [open])

  useEffect(() => {
    if (!open || dirty) return
    const value = snapshot?.value
    if (value === undefined) return
    setDraft(draftOf({ ...EMPTY_SETTINGS, ...value }))
  }, [open, snapshot?.revision, dirty])

  const values = snapshot?.value
  const status = snapshot?.status ?? 'unavailable'
  const writable = form !== undefined && snapshot?.writable === true

  const update = (key: keyof Draft, value: string): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setDirty(true)
    setSaveStatus('idle')
    setSaveError(undefined)
  }

  const windowOptions = RECENT_WINDOW_DAYS.map((days) => ({
    value: String(days),
    label: t(days === 1 ? 'settings.day' : 'settings.days', { n: days }),
  }))

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (form === undefined || !writable) return
    setSaving(true)
    setSaveStatus('idle')
    setSaveError(undefined)
    try {
      const result = await saveSettings({
        server: draft.server.trim(),
        token: draft.token.trim(),
        name: draft.name.trim(),
      }, snapshot?.revision)
      setSaveStatus(result.ok ? 'saved' : 'failed')
      if (result.ok) setDirty(false)
      else setSaveError(result.message ?? 'The Host refused the settings write.')
    } catch (error) {
      setSaveStatus('failed')
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <Modal open onClose={onClose} title={t('settings.title')} closeLabel={t('preview.close')} className={css.settingsDialog ?? ''}>
      <form className={css.settingsForm} onSubmit={(event) => { void save(event) }}>
        <section className={css.settingsSection}>
          <h3 className={css.settingsHeading}>{t('settings.recent')}</h3>
          <SegmentedControl
            id="session-manager-settings-window"
            className={css.settingsWindow ?? ''}
            value={String(windowDays)}
            options={windowOptions}
            onChange={(value) => {
              onWindowDays(Number(value))
            }}
            label={t('settings.recent')}
          />
        </section>

        <section className={css.settingsSection}>
          <h3 className={css.settingsHeading}>{t('settings.network')}</h3>
          <label className={css.settingsField}>
            <span className={css.settingsLabel}>{t('settings.server')}</span>
            <Input
              value={draft.server}
              onChange={(event) => { update('server', event.currentTarget.value) }}
              placeholder="ws://127.0.0.1:8787"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className={css.settingsField}>
            <span className={css.settingsLabel}>{t('settings.token')}</span>
            <Input
              value={draft.token}
              onChange={(event) => { update('token', event.currentTarget.value) }}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className={css.settingsField}>
            <span className={css.settingsLabel}>{t('settings.name')}</span>
            <Input
              value={draft.name}
              onChange={(event) => { update('name', event.currentTarget.value) }}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        </section>

        <p className={css.settingsHint}>{t('settings.live')}</p>

        <footer className={css.settingsActions}>
          <span className={css.settingsStatus} role="status">
            {saving
              ? t('settings.saving')
              : saveStatus === 'saved'
                ? t('settings.saved')
                : saveStatus === 'failed'
                  ? saveError === undefined
                    ? t('settings.failed')
                    : t('settings.failedDetail', { message: saveError })
                  : status === 'loading'
                    ? t('settings.loading')
                    : status === 'unavailable' || values === undefined
                      ? t('settings.unavailable')
                      : ''}
          </span>
          <button type="button" className={css.dialogAction} onClick={onClose}>{t('preview.close')}</button>
          <button type="submit" className={css.settingsSave} disabled={!writable || saving}>
            {t('settings.save')}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

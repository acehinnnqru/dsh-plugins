/**
 * The plain-value shape the settings dialog edits through `ctx.configForms`.
 * @module dsh-plugin-session-manager/client/settings
 */

/** Profile entry id this plugin's form is keyed by. */
export const SETTINGS_ENTRY = 'session-manager'

/** Network fields shown in the board settings dialog. */
export interface SessionManagerSettings {
  readonly server: string
  readonly token: string
  readonly name: string
}

/** Values shown before the Host form arrives. */
export const EMPTY_SETTINGS: SessionManagerSettings = {
  server: '',
  token: '',
  name: '',
}

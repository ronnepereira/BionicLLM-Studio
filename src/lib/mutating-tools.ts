/**
 * Tools that can change something outside the conversation.
 *
 * Two things strip these from a turn's catalog: Code-Review Mode, and a
 * read-only slash command (/review, /plan, /diff, /explain, /find, /todo,
 * /security). Read-only inspectors stay (file_read / file_list /
 * file_search) so the agent can still do the looking the command asked for.
 *
 * Since the 2.6.6 tool merge, shell_execute is the special case: it is
 * mutating (it can run anything), yet it must SURVIVE the read-only strip,
 * because the typed inspectors (git_status, git_log, git_diff, task status)
 * live inside it now. The gate moved from the catalog to the executor:
 * a read-only turn sets a flag (agent-context) and executeShellExecute only
 * runs commands isReadOnlyCommand() approves. allowedInReadOnlyTurn() is
 * what the catalog filters use so this exception lives in one place.
 *
 * Shared between useCodex and useAgentChat so the same command behaves the same
 * in the Code tab and in Agent mode. It lived only in useCodex until 2.5.9,
 * which is part of why the flag was decorative in the first place.
 */
export const MUTATING_TOOLS = new Set([
  'remotion_write', 'remotion_import_asset', 'remotion_compositions', 'remotion_preview', 'remotion_render', 'remotion_cancel',
  'studio_agent_create', 'studio_schedule_create', 'studio_agents_run', 'studio_agent_delete', 'studio_schedule_delete',
  'instagram_image_prepare',
  'instagram_reel_prepare',
  'facebook_page_prepare',
  'linkedin_prepare',
  'youtube_prepare',
  'tiktok_prepare',
  'google_gmail_prepare',
  'google_calendar_prepare',
  'google_drive_prepare',
  'file_write',
  'file_edit',
  'shell_execute',
  'image_generate',
  'video_generate',
  'run_workflow',
  'delegate_task',
  'screenshot',
  // Astra computer use: clicks and types anywhere the user approved.
  'computer_use',
  'browser_action',
  'browser_open',
  'computer_task',
  // A11: changes an app setting (after the user's yes on the card).
  'set_setting',
])

/** May this tool stay in the catalog during a read-only turn? */
export function allowedInReadOnlyTurn(name: string): boolean {
  return name === 'shell_execute' || !MUTATING_TOOLS.has(name)
}

// Formatting helpers shared by every page, so dates and sizes read the same everywhere.

const dateTime = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : '—';
}

export function formatDate(value: string | null | undefined): string {
  return value ? dateOnly.format(new Date(value)) : '—';
}

// "5 minutes ago", "yesterday", or a date for anything older than a week.
export function timeAgo(value: string | null | undefined): string {
  if (!value) return '—';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDate(value);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

// Readable text for audit log action codes, e.g. DOCUMENT_CREATED -> "created a document".
const ACTION_TEXT: Record<string, string> = {
  LOGIN_SUCCESS: 'signed in',
  LOGIN_FAILED: 'failed to sign in',
  LOGIN_LOCKED: 'was locked out',
  ACCOUNT_CREATED: 'created an office',
  ACCOUNT_UPDATED: 'updated an office',
  USER_CREATED: 'added a user',
  USER_UPDATED: 'updated a user',
  USER_ACTIVATED: 'activated a user',
  USER_DEACTIVATED: 'deactivated a user',
  USER_PASSWORD_RESET: 'reset a user\'s password',
  USER_UNLOCKED: 'unlocked a user',
  PASSWORD_CHANGED: 'changed their password',
  CATEGORY_CREATED: 'added a category',
  CATEGORY_UPDATED: 'updated a category',
  FIELD_CREATED: 'added a field',
  FIELD_UPDATED: 'updated a field',
  TEMPLATE_CREATED: 'created a template',
  TEMPLATE_UPDATED: 'updated template details',
  TEMPLATE_VERSION_SAVED: 'saved a template version',
  TEMPLATE_PUBLISHED: 'published a template',
  TEMPLATE_ARCHIVED: 'archived a template',
  TEMPLATE_DRAFT: 'moved a template back to draft',
  TEMPLATE_DUPLICATED: 'duplicated a template',
  DOCUMENT_CREATED: 'created',
  DOCUMENT_UPLOADED: 'uploaded',
  DOCUMENT_EDITED: 'edited',
  DOCUMENT_UPDATED: 'renamed or moved',
  DOCUMENT_FILE_REPLACED: 'uploaded a new version of',
  DOCUMENT_DUPLICATED: 'duplicated',
  DOCUMENT_ARCHIVED: 'archived',
  DOCUMENT_RESTORED: 'restored',
  DOCUMENT_DELETED: 'moved to the trash',
  DOCUMENT_UNDELETED: 'restored from the trash',
  DOCUMENT_PURGED: 'deleted forever',
  TRASH_EMPTIED: 'emptied the trash',
  DOCUMENT_DOWNLOADED: 'downloaded',
  DOCUMENT_CONVERTED: 'converted a file into',
  DOCUMENT_SHARED: 'shared',
  DOCUMENT_TEXT_EDITED: 'edited the text of',
  SHARE_LINK_REVOKED: 'turned off a share link for',
  ASSET_UPLOADED: 'uploaded an image',
  SETTINGS_UPDATED: 'changed the application settings',
};

export function actionText(action: string): string {
  return ACTION_TEXT[action] ?? action.toLowerCase().replace(/_/g, ' ');
}

export function roleLabel(role: string): string {
  return role === 'MasterAdmin' ? 'Master Admin' : role;
}

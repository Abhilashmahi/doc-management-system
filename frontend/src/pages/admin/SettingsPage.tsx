import { useEffect, useState, type FormEvent } from 'react';
import { useSession } from '../../app/session';
import { Button, Card, Checkbox, ErrorBanner, LoadingBlock, PageHeader, SelectField, TextField, fieldErrors, useLoad, useToast } from '../../components/kit';
import { errorMessage, http } from '../../lib/api';
import type { AppSettings } from '../../lib/types';

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

// Settings that apply to every office: name, colour, sign-up, uploads and how long the audit log is kept.
export function SettingsPage() {
  const session = useSession();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(
    () => http.get<{ settings: AppSettings; supportedFileTypes: string[] }>('/settings'),
    [],
  );

  // Form values. Number boxes are kept as text while typing.
  const [appName, setAppName] = useState('');
  const [brandColor, setBrandColor] = useState('#4f46e5');
  const [allowSelfSignup, setAllowSelfSignup] = useState(false);
  const [allowedFileTypes, setAllowedFileTypes] = useState<string[]>([]);
  const [maxUploadMb, setMaxUploadMb] = useState('');
  const [defaultExportFormat, setDefaultExportFormat] = useState<AppSettings['defaultExportFormat']>('pdf');
  const [auditRetentionDays, setAuditRetentionDays] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fill the form once the saved settings arrive.
  useEffect(() => {
    if (!data) return;
    const s = data.settings;
    setAppName(s.appName);
    setBrandColor(s.brandColor);
    setAllowSelfSignup(s.allowSelfSignup);
    setAllowedFileTypes(s.allowedFileTypes);
    setMaxUploadMb(String(s.maxUploadMb));
    setDefaultExportFormat(s.defaultExportFormat);
    setAuditRetentionDays(String(s.auditRetentionDays));
  }, [data]);

  function toggleType(type: string, on: boolean) {
    setAllowedFileTypes((current) => (on ? [...current, type] : current.filter((t) => t !== type)));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await http.put('/settings', {
        appName,
        brandColor,
        allowSelfSignup,
        allowedFileTypes,
        maxUploadMb: Number(maxUploadMb),
        defaultExportFormat,
        auditRetentionDays: Number(auditRetentionDays),
      });
      toast('Settings saved.');
      await session.reloadSettings().catch(() => undefined);
    } catch (e) {
      setErrors(fieldErrors(e));
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <LoadingBlock />;
  if (error || !data) {
    return (
      <div>
        <PageHeader title="Settings" description="Application-wide settings for every office." />
        <ErrorBanner message={error ?? 'Could not load the settings.'} onRetry={reload} />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <PageHeader
        title="Settings"
        description="Application-wide settings for every office."
        actions={<Button variant="primary" type="submit" busy={saving}>Save settings</Button>}
      />

      {formError && (
        <div className="mb-4">
          <ErrorBanner message={formError} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Appearance">
          <div className="space-y-4">
            <TextField label="Application name" required value={appName} onChange={setAppName} error={errors.appName} maxLength={100} hint="Shown in the sidebar, the sign-in page and the browser tab." />
            <div>
              <label htmlFor="brand-colour-text" className="mb-1 block text-sm font-medium text-slate-700">Brand colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick brand colour"
                  value={HEX_COLOUR.test(brandColor) ? brandColor : '#000000'}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="h-10 w-12 cursor-pointer rounded-lg border border-slate-300 bg-surface p-1"
                />
                <input
                  id="brand-colour-text"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  maxLength={7}
                  aria-invalid={Boolean(errors.brandColor)}
                  aria-describedby={errors.brandColor ? 'brand-colour-error' : undefined}
                  className="w-32 rounded-lg border border-slate-300 bg-surface px-3 py-2 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 aria-[invalid=true]:border-red-500"
                />
              </div>
              {errors.brandColor && <p id="brand-colour-error" className="mt-1 text-xs text-red-600">{errors.brandColor}</p>}
            </div>
          </div>
        </Card>

        <Card title="Sign-in">
          <Checkbox
            label="Allow people to create their own office"
            checked={allowSelfSignup}
            onChange={setAllowSelfSignup}
            hint='Shows "Create an account" on the sign-in page. Anyone who signs up gets a new, empty office and becomes its Admin.'
          />
        </Card>

        <Card title="Uploads">
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">Allowed file types</legend>
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                <button type="button" className="font-medium text-indigo-600 hover:underline" onClick={() => setAllowedFileTypes(data.supportedFileTypes)}>Select all</button>
                <span className="text-slate-300">|</span>
                <button type="button" className="font-medium text-indigo-600 hover:underline" onClick={() => setAllowedFileTypes([])}>Clear</button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {data.supportedFileTypes.filter((type) => type !== '*').map((type) => (
                  <Checkbox key={type} label={`.${type.replace(/^\./, '')}`} checked={allowedFileTypes.includes(type)} onChange={(on) => toggleType(type, on)} />
                ))}
              </div>
              {data.supportedFileTypes.includes('*') && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3">
                  <Checkbox
                    label="Also allow any other file type"
                    hint="Files of other types are stored and can be downloaded, but not previewed or converted. Programs and scripts (.exe, .bat, .ps1, .js and similar) are always refused for safety."
                    checked={allowedFileTypes.includes('*')}
                    onChange={(on) => toggleType('*', on)}
                  />
                </div>
              )}
              {errors.allowedFileTypes && <p className="mt-1 text-xs text-red-600">{errors.allowedFileTypes}</p>}
            </fieldset>
            <TextField label="Largest upload (MB)" type="number" min={1} max={500} required value={maxUploadMb} onChange={setMaxUploadMb} error={errors.maxUploadMb} hint="Between 1 and 500 MB." />
          </div>
        </Card>

        <Card title="Documents and audit log">
          <div className="space-y-4">
            <SelectField
              label="Default export format"
              value={defaultExportFormat}
              onChange={(v) => setDefaultExportFormat(v as AppSettings['defaultExportFormat'])}
              options={[
                { value: 'pdf', label: 'PDF' },
                { value: 'png', label: 'PNG image' },
                { value: 'jpeg', label: 'JPEG image' },
              ]}
              error={errors.defaultExportFormat}
            />
            <TextField
              label="Keep activity log for (days)"
              type="number"
              min={30}
              max={3650}
              required
              value={auditRetentionDays}
              onChange={setAuditRetentionDays}
              error={errors.auditRetentionDays}
              hint="How long activity entries must be kept. At least 30 days."
            />
          </div>
        </Card>
      </div>
    </form>
  );
}

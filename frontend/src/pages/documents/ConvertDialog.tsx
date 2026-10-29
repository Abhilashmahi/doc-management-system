import { useState } from 'react';
import { Badge, Button, ErrorBanner, LoadingBlock, Modal, useLoad, useToast } from '../../components/kit';
import { errorMessage, http } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { navigate } from '../../lib/router';
import type { DocumentSummary } from '../../lib/types';

interface ConversionOption {
  to: string;
  label: string;
  quality: 'exact' | 'good' | 'text-only';
  engine: 'built-in' | 'libreoffice';
  available: boolean;
  note?: string;
}

const QUALITY: Record<ConversionOption['quality'], { label: string; tone: 'green' | 'blue' | 'amber'; text: string }> = {
  exact: { label: 'Exact', tone: 'green', text: 'Looks the same as the original.' },
  good: { label: 'Good', tone: 'blue', text: 'Content and structure kept; small layout differences are possible.' },
  'text-only': { label: 'Text only', tone: 'amber', text: 'Only the words are kept.' },
};

// Lets the user pick a target format. The result is saved as a new document next to the original,
// which itself is never changed.
export function ConvertDialog({ doc, onClose }: { doc: DocumentSummary; onClose: () => void }) {
  const toast = useToast();
  const { data, error, loading } = useLoad(() => http.get<{ from: string | null; options: ConversionOption[] }>(`/documents/${doc.id}/conversions`), [doc.id]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const chosen = data?.options.find((o) => o.to === selected) ?? null;

  async function run(download: boolean) {
    if (!chosen) return;
    setBusy(true);
    setConvertError(null);
    try {
      const result = await http.post<{ id: number; name: string; ext: string; sizeBytes: number }>(`/documents/${doc.id}/convert`, { to: chosen.to });
      toast(`Saved “${result.name}” (${formatBytes(result.sizeBytes)}).`);
      if (download) window.location.assign(`/api/documents/${result.id}/file`);
      navigate(`/documents/${result.id}`);
      onClose();
    } catch (e) {
      setConvertError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Convert “${doc.name}”`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={!chosen?.available} busy={busy} onClick={() => run(true)}>Convert and download</Button>
          <Button variant="primary" disabled={!chosen?.available} busy={busy} onClick={() => run(false)}>Convert</Button>
        </>
      }
    >
      {loading && <LoadingBlock />}
      {error && <ErrorBanner message={error} />}
      {data && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            The converted file is saved as a <strong>new document</strong> in the same folder. The original {data.from ? `.${data.from} ` : ''}file is never changed.
          </p>

          {data.options.length === 0 ? (
            <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-medium text-slate-800">No conversions for this file type</p>
              <p className="mt-1">
                {data.from
                  ? `.${data.from} files can be stored and downloaded, but the app cannot convert them into another format.`
                  : 'Designed documents are converted with Export (PDF, PNG or JPEG) on the document page.'}
              </p>
            </div>
          ) : (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">Convert to</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.options.map((o) => (
                  <label
                    key={o.to}
                    className={`flex cursor-pointer gap-3 rounded-lg p-3 ring-1 ${!o.available ? 'cursor-not-allowed opacity-60 ring-slate-200' : selected === o.to ? 'bg-indigo-50 ring-2 ring-indigo-500' : 'ring-slate-200 hover:bg-slate-50'}`}
                  >
                    <input type="radio" name="convert-to" value={o.to} disabled={!o.available} checked={selected === o.to} onChange={() => setSelected(o.to)} className="mt-1 h-4 w-4 text-indigo-600" />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{o.label}</span>
                        <Badge tone={QUALITY[o.quality].tone}>{QUALITY[o.quality].label}</Badge>
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">{o.note ?? QUALITY[o.quality].text}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {data.options.some((o) => !o.available) && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              Some conversions need <strong>LibreOffice</strong>, a free office suite. When an administrator installs it on the server
              (libreoffice.org), these options switch on by themselves.
            </p>
          )}
          {convertError && <ErrorBanner message={convertError} />}
          {busy && <p className="text-sm text-slate-500">Converting… large files can take a little while.</p>}
        </div>
      )}
    </Modal>
  );
}

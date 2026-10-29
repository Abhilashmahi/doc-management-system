import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../app/session';
import { Button, Checkbox, Modal, SelectField, TextAreaField, TextField, useToast } from '../../components/kit';
import { buildDesignPdf, safeFileName } from '../../designer/export';
import { ApiError, errorMessage, http } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import type { DocumentDetail } from '../../lib/types';

// Share a document by WhatsApp, Gmail or a download link.
// - WhatsApp: on phones (and Windows with the WhatsApp app) the file itself goes through the device's share menu.
//   Otherwise WhatsApp opens with the message ready and the file is downloaded to attach.
// - Gmail: the server e-mails the file as an attachment when an administrator has set up sending;
//   otherwise Gmail opens a new message and the file is downloaded to attach.
// - Link: a secret download link that expires, for pasting anywhere.

interface ShareStatus {
  emailEnabled: boolean;
  emailFrom: string | null;
  publicUrl: string;
  publicUrlIsLocal: boolean;
}

interface ShareLink {
  id: number;
  createdAt: string;
  expiresAt: string;
  downloadCount: number;
  lastDownloadedAt: string | null;
  createdByName: string;
}

type Tab = 'whatsapp' | 'gmail' | 'link';

// Server errors carry their own message; anything else (e.g. building the PDF) uses the error's text.
function problem(e: unknown): string {
  return e instanceof ApiError || !(e instanceof Error) ? errorMessage(e) : e.message;
}

export function ShareDialog({ detail, onClose }: { detail: DocumentDetail; onClose: () => void }) {
  const session = useSession();
  const toast = useToast();
  const doc = detail.document;
  const canChange = session.canEdit && Boolean(session.accountId) && !doc.isArchived;
  const [tab, setTab] = useState<Tab>('whatsapp');
  const [status, setStatus] = useState<ShareStatus | null>(null);

  useEffect(() => {
    http.get<ShareStatus>('/share/status').then(setStatus).catch(() => setStatus(null));
  }, []);

  // The file is made once and reused: the stored file, or the PDF of a designed document (same as Export).
  const fileRef = useRef<Promise<File> | null>(null);
  function getFile(): Promise<File> {
    fileRef.current ??= (async () => {
      if (doc.sourceType === 'template') {
        if (!detail.content) throw new Error('This document has no content to share.');
        const blob = await buildDesignPdf(detail.content.canvas, detail.content.data, doc.name);
        return new File([blob], `${safeFileName(doc.name)}.pdf`, { type: 'application/pdf' });
      }
      const res = await fetch(`/api/documents/${doc.id}/file?inline=1`, { credentials: 'include' });
      if (!res.ok) throw new Error('The file could not be loaded. Please try again.');
      const blob = await res.blob();
      const ext = doc.fileName?.includes('.') ? doc.fileName.split('.').pop() : '';
      return new File([blob], ext ? `${safeFileName(doc.name)}.${ext}` : doc.fileName ?? safeFileName(doc.name), { type: blob.type || 'application/octet-stream' });
    })();
    fileRef.current.catch(() => (fileRef.current = null)); // try again next time
    return fileRef.current;
  }

  // Makes a share link; designed documents send their PDF so the link keeps that version.
  async function createLink(days: number): Promise<{ url: string; expiresAt: string }> {
    const form = new FormData();
    form.append('days', String(days));
    if (doc.sourceType === 'template') form.append('file', await getFile());
    return http.upload<{ url: string; expiresAt: string }>(`/share/documents/${doc.id}/links`, form);
  }

  function record(channel: 'whatsapp' | 'gmail' | 'device') {
    http.post(`/share/documents/${doc.id}/record`, { channel }).catch(() => undefined);
  }

  async function download() {
    const file = await getFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  const tabs: { id: Tab; label: string; color: string }[] = [
    { id: 'whatsapp', label: 'WhatsApp', color: '#25d366' },
    { id: 'gmail', label: 'Gmail', color: '#ea4335' },
    ...(canChange ? [{ id: 'link' as Tab, label: 'Link', color: '#4f46e5' }] : []),
  ];

  const shared = { doc, status, canChange, getFile, createLink, record, download, toast, onClose };

  return (
    <Modal title={`Share “${doc.name}”`} onClose={onClose} wide>
      <div role="tablist" aria-label="Share with" className="mb-5 grid grid-cols-3 gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium ring-1 transition ${tab === t.id ? 'bg-slate-50 text-slate-900 ring-2' : 'text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
            style={tab === t.id ? { ['--tw-ring-color' as string]: t.color } : undefined}
          >
            <ChannelIcon channel={t.id} color={t.color} />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'whatsapp' && <WhatsAppPanel {...shared} />}
      {tab === 'gmail' && <GmailPanel {...shared} />}
      {tab === 'link' && canChange && <LinkPanel {...shared} />}
    </Modal>
  );
}

interface PanelProps {
  doc: DocumentDetail['document'];
  status: ShareStatus | null;
  canChange: boolean;
  getFile: () => Promise<File>;
  createLink: (days: number) => Promise<{ url: string; expiresAt: string }>;
  record: (channel: 'whatsapp' | 'gmail' | 'device') => void;
  download: () => Promise<void>;
  toast: ReturnType<typeof useToast>;
  onClose: () => void;
}

// Can this browser hand files to other apps (WhatsApp, Gmail app, Bluetooth…)? True on most phones and on Windows.
function canShareFiles(): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

// Turns "98765 43210" or "+91 98765-43210" into "919876543210" (India is assumed for 10-digit numbers).
function whatsappNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

function LocalLinkWarning({ status }: { status: ShareStatus | null }) {
  if (!status?.publicUrlIsLocal) return null;
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
      Links start with <strong>{status.publicUrl}</strong>, which only works on this computer. Other people can open them once the app is on the
      internet (an administrator sets <code>PUBLIC_URL</code> in backend\.env).
    </p>
  );
}

function WhatsAppPanel({ doc, status, canChange, getFile, createLink, record, download, toast, onClose }: PanelProps) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState(`Hello, please find the document “${doc.name}”.`);
  const [withLink, setWithLink] = useState(false);
  const [busy, setBusy] = useState<'share' | 'open' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deviceShare = canShareFiles();
  const number = whatsappNumber(phone);
  const phoneError = phone.trim() && (number.length < 11 || number.length > 15) ? 'Enter the number with country code, e.g. 91 98765 43210.' : undefined;

  async function shareFile() {
    setBusy('share');
    setError(null);
    try {
      const file = await getFile();
      await navigator.share({ files: [file], text: message });
      record('device');
      onClose();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(problem(e));
    } finally {
      setBusy(null);
    }
  }

  async function openWhatsApp() {
    if (phoneError) return;
    // Open the tab first (browsers block pop-ups opened after a wait), then fill in its address.
    const tab = window.open('about:blank', '_blank');
    setBusy('open');
    setError(null);
    try {
      let text = message;
      if (withLink) {
        const link = await createLink(7);
        text = `${message}\n\nDownload (valid for 7 days): ${link.url}`;
      } else {
        await download();
      }
      const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
      record('whatsapp');
      toast(withLink ? 'WhatsApp opened with the link in the message.' : 'WhatsApp opened. Attach the downloaded file with the 📎 button.');
    } catch (e) {
      tab?.close();
      setError(problem(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {deviceShare && (
        <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
          <p className="text-sm font-medium text-slate-900">Send the file itself</p>
          <p className="mt-0.5 text-sm text-slate-600">Opens your device’s share menu. Choose <strong>WhatsApp</strong>, then the person.</p>
          <Button className="mt-3 !bg-[#25d366] !text-white hover:!bg-[#1ebe5b]" busy={busy === 'share'} onClick={() => void shareFile()}>
            <ChannelIcon channel="whatsapp" color="#fff" /> Share file to WhatsApp
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {deviceShare && <p className="text-sm font-medium text-slate-900">Or open WhatsApp with a message</p>}
        <TextField
          label="WhatsApp number (optional)"
          value={phone}
          onChange={setPhone}
          inputMode="tel"
          placeholder="91 98765 43210"
          error={phoneError}
          hint="Leave empty to choose the person in WhatsApp."
        />
        <TextAreaField label="Message" value={message} onChange={setMessage} maxLength={1000} />
        {canChange && (
          <Checkbox
            label="Put a download link in the message instead of attaching the file"
            checked={withLink}
            onChange={setWithLink}
            hint="The link works for 7 days. You can turn it off any time under Link."
          />
        )}
        {withLink && <LocalLinkWarning status={status} />}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={deviceShare ? 'secondary' : 'primary'} busy={busy === 'open'} disabled={Boolean(phoneError)} onClick={() => void openWhatsApp()}>
            Open WhatsApp
          </Button>
          {!withLink && <span className="text-xs text-slate-500">The file downloads too, ready to attach. WhatsApp cannot receive files from a web link.</span>}
        </div>
      </div>
    </div>
  );
}

function GmailPanel({ doc, status, canChange, getFile, record, download, toast, onClose }: PanelProps) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(doc.name);
  const [message, setMessage] = useState(`Hello,\n\nPlease find “${doc.name}” attached.\n\nRegards`);
  const [busy, setBusy] = useState<'send' | 'open' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const direct = Boolean(status?.emailEnabled && canChange);

  async function send() {
    setBusy('send');
    setError(null);
    try {
      const form = new FormData();
      form.append('to', to);
      form.append('subject', subject);
      form.append('message', message);
      if (doc.sourceType === 'template') form.append('file', await getFile());
      const result = await http.upload<{ to: string[] }>(`/share/documents/${doc.id}/email`, form);
      toast(`E-mail sent to ${result.to.join(', ')}.`);
      onClose();
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(null);
    }
  }

  async function openGmail() {
    const tab = window.open('about:blank', '_blank');
    setBusy('open');
    setError(null);
    try {
      await download();
      const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
      record('gmail');
      toast('Gmail opened. Attach the downloaded file with the 📎 button.');
    } catch (e) {
      tab?.close();
      setError(problem(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <TextField label="To" value={to} onChange={setTo} type="text" inputMode="email" placeholder="name@gmail.com" hint="Separate several addresses with commas." required={direct} />
      <TextField label="Subject" value={subject} onChange={setSubject} maxLength={200} />
      <TextAreaField label="Message" value={message} onChange={setMessage} maxLength={5000} rows={5} />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {direct ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" busy={busy === 'send'} disabled={!to.trim() || !subject.trim()} onClick={() => void send()}>
            <ChannelIcon channel="gmail" color="#fff" /> Send with file attached
          </Button>
          <span className="text-xs text-slate-500">Sent from {status?.emailFrom}</span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" busy={busy === 'open'} onClick={() => void openGmail()}>
              <ChannelIcon channel="gmail" color="#fff" /> Open in Gmail
            </Button>
            <span className="text-xs text-slate-500">The file downloads too, ready to attach.</span>
          </div>
          {status && !status.emailEnabled && canChange && <EmailSetupHint />}
        </>
      )}
    </div>
  );
}

function EmailSetupHint() {
  return (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
      To send with the file attached in one click, an administrator connects a Gmail account: add <code>SMTP_USER</code> (the Gmail address) and{' '}
      <code>SMTP_PASSWORD</code> (a Gmail App Password) to backend\.env and restart the backend.
    </p>
  );
}

function LinkPanel({ doc, status, createLink, toast }: PanelProps) {
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [links, setLinks] = useState<ShareLink[] | null>(null);

  function loadLinks() {
    http.get<{ links: ShareLink[] }>(`/share/documents/${doc.id}/links`).then((r) => setLinks(r.links)).catch(() => setLinks([]));
  }
  useEffect(loadLinks, [doc.id]);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      setCreated(await createLink(Number(days)));
      loadLinks();
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Link copied.');
    } catch {
      toast('Select the link and copy it.', 'error');
    }
  }

  async function turnOff(id: number) {
    try {
      await http.del(`/share/links/${id}`);
      if (created) setCreated(null);
      loadLinks();
      toast('Link turned off. It no longer opens.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Anyone who has the link can download this document until it expires. No sign-in is needed.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <SelectField
            label="Link works for"
            value={days}
            onChange={setDays}
            options={[1, 3, 7, 14, 30].map((d) => ({ value: String(d), label: d === 1 ? '1 day' : `${d} days` }))}
          />
        </div>
        <Button variant="primary" busy={busy} onClick={() => void make()} className="mb-0.5">
          Create link
        </Button>
      </div>
      <LocalLinkWarning status={status} />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {created && (
        <div className="rounded-xl bg-indigo-50 p-3 ring-1 ring-indigo-200">
          <p className="text-xs font-medium text-slate-700">New link — copy it now; it is not shown again.</p>
          <div className="mt-2 flex gap-2">
            <input readOnly value={created.url} onFocus={(e) => e.target.select()} aria-label="Share link" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-surface px-2 py-1.5 text-xs text-slate-800" />
            <Button size="sm" onClick={() => void copy(created.url)}>Copy</Button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${doc.name}: ${created.url}`)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-[#25d366] px-2.5 py-1.5 text-xs font-medium text-white"
            >
              <ChannelIcon channel="whatsapp" color="#fff" /> WhatsApp
            </a>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-medium text-slate-900">Active links</p>
        {links === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : links.length === 0 ? (
          <p className="text-sm text-slate-500">No active links.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-slate-700">
                  By {l.createdByName}, {timeAgo(l.createdAt)} · expires {new Date(l.expiresAt).toLocaleDateString()} · {l.downloadCount} download{l.downloadCount === 1 ? '' : 's'}
                </span>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => void turnOff(l.id)}>
                  Turn off
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ChannelIcon({ channel, color }: { channel: Tab; color: string }) {
  if (channel === 'whatsapp') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={color} aria-hidden="true">
        <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3z" />
      </svg>
    );
  }
  if (channel === 'gmail') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}

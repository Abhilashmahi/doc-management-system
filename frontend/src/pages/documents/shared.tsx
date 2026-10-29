import { useEffect, useState, type DragEvent } from 'react';
import { useSession } from '../../app/session';
import { Button, ErrorBanner, Modal, SelectField, TextField, fieldErrors, useToast } from '../../components/kit';
import { errorMessage, http } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import type { Category, DocumentSummary } from '../../lib/types';

// Pieces used by more than one document page.

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    let cancelled = false;
    http
      .get<{ categories: Category[] }>('/categories')
      .then((r) => !cancelled && setCategories(r.categories))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return categories;
}

export function useFolders() {
  const [folders, setFolders] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    http
      .get<{ folders: { folderPath: string }[] }>('/documents/folders')
      .then((r) => !cancelled && setFolders(r.folders.map((f) => f.folderPath)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return folders;
}

// Folder input with suggestions from folders already in use. "/" is the top level.
export function FolderInput({ value, onChange, folders, error }: { value: string; onChange: (v: string) => void; folders: string[]; error?: string }) {
  return (
    <>
      <TextField label="Folder" value={value} onChange={onChange} list="folder-suggestions" placeholder="/" hint="Use / for sub-folders, e.g. /2026/October" error={error} />
      <datalist id="folder-suggestions">
        {folders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </>
  );
}

// Programs and scripts are refused by the server whatever the settings say; checking here gives a faster message.
const BLOCKED = ['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'jse', 'wsf', 'hta', 'dll', 'jar', 'sh', 'lnk', 'reg'];

export function UploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: (id: number) => void }) {
  const session = useSession();
  const toast = useToast();
  const categories = useCategories();
  const folders = useFolders();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [folder, setFolder] = useState('/');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const allowedSetting = session.settings?.allowedFileTypes ?? ['pdf', 'png', 'jpg', 'jpeg'];
  const anyType = allowedSetting.includes('*');
  const allowed = allowedSetting.filter((t) => t !== '*');
  const maxMb = session.settings?.maxUploadMb ?? 20;

  function pick(f: File | undefined | null) {
    if (!f) return;
    setError(null);
    const ext = f.name.includes('.') ? (f.name.split('.').pop()?.toLowerCase() ?? '') : '';
    if (BLOCKED.includes(ext)) {
      setError(`.${ext} files are programs or scripts, and they are never accepted for safety.`);
      return;
    }
    if (!allowed.includes(ext) && !(anyType && ext)) {
      setError(ext ? `.${ext} files are not allowed. Allowed: ${allowed.join(', ')}.` : 'The file needs an extension (for example .pdf) so its type is known.');
      return;
    }
    if (f.size > maxMb * 1024 * 1024) {
      setError(`The file is larger than the ${maxMb} MB limit.`);
      return;
    }
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  }

  async function submit() {
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setBusy(true);
    setError(null);
    setErrors({});
    const form = new FormData();
    form.append('file', file);
    form.append('name', name.trim());
    form.append('folder', folder || '/');
    if (categoryId) form.append('categoryId', categoryId);
    try {
      const result = await http.upload<{ id: number }>('/documents/upload', form);
      toast('Document uploaded.');
      onUploaded(result.id);
    } catch (e) {
      setError(errorMessage(e));
      setErrors(fieldErrors(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Upload a document"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={submit}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center ${dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 hover:bg-slate-50'}`}
        >
          <input type="file" className="sr-only" accept={anyType ? undefined : allowed.map((t) => `.${t}`).join(',')} onChange={(e) => pick(e.target.files?.[0])} />
          {file ? (
            <>
              <span className="font-medium text-slate-900">{file.name}</span>
              <span className="mt-1 text-xs text-slate-500">{formatBytes(file.size)} · click to choose another file</span>
            </>
          ) : (
            <>
              <span className="font-medium text-slate-800">Drop a file here or click to choose</span>
              <span className="mt-1 text-xs text-slate-500">
                {anyType ? 'Any file type' : allowed.join(', ').toUpperCase()} · up to {maxMb} MB
              </span>
            </>
          )}
        </label>
        <TextField label="Document name" value={name} onChange={setName} error={errors.name} maxLength={200} />
        <SelectField label="Category" value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} placeholder="No category" />
        <FolderInput value={folder} onChange={setFolder} folders={folders} error={errors.folder} />
        <p className="text-xs text-slate-500">The original file is stored unchanged. Later uploads become new versions; the original is always kept.</p>
        {error && <ErrorBanner message={error} />}
      </div>
    </Modal>
  );
}

export function RenameMoveDialog({ doc, onClose, onSaved }: { doc: DocumentSummary; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const categories = useCategories();
  const folders = useFolders();
  const [name, setName] = useState(doc.name);
  const [categoryId, setCategoryId] = useState(doc.categoryId ? String(doc.categoryId) : '');
  const [folder, setFolder] = useState(doc.folderPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await http.put(`/documents/${doc.id}`, { name, categoryId: categoryId ? Number(categoryId) : null, folder });
      toast('Document details saved.');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setErrors(fieldErrors(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Rename or move"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="Document name" value={name} onChange={setName} error={errors.name} required maxLength={200} />
        <SelectField label="Category" value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} placeholder="No category" />
        <FolderInput value={folder} onChange={setFolder} folders={folders} error={errors.folder} />
        {error && <ErrorBanner message={error} />}
      </div>
    </Modal>
  );
}

// A short label for a file type, shown in lists.
export function fileKind(doc: Pick<DocumentSummary, 'sourceType' | 'fileName'>): string {
  if (doc.sourceType === 'template') return 'Designed';
  return (doc.fileName?.split('.').pop() ?? 'file').toUpperCase();
}

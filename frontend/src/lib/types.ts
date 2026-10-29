// Shapes of the data the API returns. They mirror the SELECT column names in backend/src/routes.

import type { CanvasDocument } from '../designer/types';

export type Role = 'MasterAdmin' | 'Admin' | 'Editor' | 'Viewer';

export interface Category {
  id: number;
  accountId: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  documentCount: number;
  templateCount: number;
}

export type FieldDataType = 'text' | 'number' | 'date' | 'select' | 'multiline';

export interface FieldValidation {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  patternMessage?: string;
  options?: string[];
}

export interface FieldDefinition {
  id: number;
  accountId: number;
  fieldKey: string;
  label: string;
  dataType: FieldDataType;
  validation: FieldValidation;
  defaultValue: string;
  isVisible: boolean;
  isActive: boolean;
}

// Per-template settings for a field placed on the canvas.
export interface TemplateField {
  fieldKey: string;
  required: boolean;
  defaultValue: string;
}

export type TemplateStatus = 'Draft' | 'Published' | 'Archived';

export interface Template {
  id: number;
  accountId: number;
  categoryId: number | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  status: TemplateStatus;
  currentVersionNo: number;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
  documentCount: number;
}

export interface VersionInfo {
  versionNo: number;
  createdAt: string;
  createdByName: string;
}

export interface TemplateDetail {
  template: Template;
  canvas: CanvasDocument;
  fields: TemplateField[];
  versions: VersionInfo[];
}

export interface DocumentSummary {
  id: number;
  accountId: number;
  name: string;
  status: 'Draft' | 'Final';
  sourceType: 'template' | 'upload';
  folderPath: string;
  categoryId: number | null;
  categoryName: string | null;
  templateId: number | null;
  templateName: string | null;
  templateVersionNo: number | null;
  currentVersionNo: number;
  isArchived: boolean;
  fileId: number | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  createdByName: string;
  updatedByName: string | null;
  deletedAt?: string | null;
  deletedByName?: string | null;
}

export interface DocumentVersion extends VersionInfo {
  note: string | null;
  fileId: number | null;
  fileName: string | null;
  sizeBytes: number | null;
}

export interface DocumentDetail {
  document: DocumentSummary;
  versions: DocumentVersion[];
  content: {
    data: Record<string, string>;
    canvas: CanvasDocument;
    fields: TemplateField[];
    definitions: FieldDefinition[];
  } | null;
}

export interface UserRow {
  id: number;
  accountId: number | null;
  accountName: string | null;
  username: string;
  email: string | null;
  fullName: string;
  role: Role;
  isActive: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  hasPassword: boolean;
  hasGoogle: boolean;
}

export interface Account {
  id: number;
  name: string;
  isActive: boolean;
  storageLimitBytes: number;
  storageUsedBytes: number;
  createdAt: string;
  userCount: number;
  documentCount: number;
  templateCount: number;
  lastActivityAt: string | null;
}

export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
  userName: string | null;
  username: string | null;
  accountName: string | null;
  documentName: string | null;
}

export interface AppSettings {
  appName: string;
  brandColor: string;
  allowSelfSignup: boolean;
  allowedFileTypes: string[];
  maxUploadMb: number;
  defaultExportFormat: 'pdf' | 'png' | 'jpeg';
  auditRetentionDays: number;
}

export interface StoredAsset {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt?: string;
}

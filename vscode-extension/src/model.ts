import { BSON } from 'bson';
import type { ReportLayout } from './builder/layout';
import { DOCUMENT_TYPES, DocumentType, Margin, ProjectConfig } from './config/parse';

export interface Asset {
  id: string;
  /** data: URI of the image. */
  data: string;
}

/**
 * Contents of a .zrpt file. The shape matches what the Electron designer writes and
 * what the Kotlin and .NET servers read, so files stay interchangeable.
 */
export interface ReportModel {
  name: string;
  landscape: boolean;
  documentType: DocumentType;
  margin: Margin;
  code: string;
  data: string;
  style: string;
  script: string;
  assets: Asset[];
  /**
   * Visual builder layout. When set, `code` is generated from it; servers ignore this field.
   * null or absent means the report is edited as code.
   */
  layout?: ReportLayout | null;
  /** The layout set aside by "Detach to code", so the report can be re-attached later. */
  detachedLayout?: ReportLayout | null;
  /** Legacy per-file server URL. Preserved on save; report-designer.toml takes over when present. */
  deploymentUrl?: string | null;
  /** Fields this version doesn't know about, kept so saving never drops data. */
  [extra: string]: unknown;
}

/** Fields the webview edits. Assets are changed only by the extension host. */
export type EditableFields = Pick<ReportModel, 'name' | 'landscape' | 'documentType' | 'margin' | 'code' | 'data' | 'style' | 'script' | 'layout'>;

export const DEFAULT_SCRIPT = `Handlebars.registerHelper('currentDate', function () {
  return moment().format("MMM Do YY");
});

/**
 * use for custom data execution
 * dont remove
 */
function appScript(){

}
`;

export function newReport(name: string, config?: ProjectConfig): ReportModel {
  const d = config?.defaults;
  return {
    name,
    landscape: d?.orientation === 'landscape',
    documentType: d?.documentType ?? 'A4',
    margin: {
      top: d?.margin?.top ?? '20',
      right: d?.margin?.right ?? '20',
      bottom: d?.margin?.bottom ?? '20',
      left: d?.margin?.left ?? '20',
    },
    code: '',
    data: '',
    style: '',
    script: DEFAULT_SCRIPT,
    assets: [],
  };
}

export function decodeReport(bytes: Uint8Array): ReportModel {
  if (bytes.byteLength === 0) return newReport('Untitled Report');
  const raw = BSON.deserialize(bytes) as Record<string, unknown>;
  const margin = (raw.margin ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fallback = '') => (v === undefined || v === null ? fallback : String(v));
  const docType = DOCUMENT_TYPES.find((d) => d.toLowerCase() === str(raw.documentType).toLowerCase()) ?? 'A4';

  return {
    ...raw,
    name: str(raw.name, 'Untitled Report'),
    landscape: raw.landscape === true,
    documentType: docType,
    margin: {
      top: str(margin.top, '20'),
      right: str(margin.right, '20'),
      bottom: str(margin.bottom, '20'),
      left: str(margin.left, '20'),
    },
    code: str(raw.code),
    data: str(raw.data),
    style: str(raw.style),
    script: str(raw.script),
    assets: Array.isArray(raw.assets)
      ? raw.assets.map((a: Record<string, unknown>) => ({ id: str(a.id), data: str(a.data) }))
      : [],
  };
}

export function encodeReport(model: ReportModel): Uint8Array {
  return BSON.serialize(model);
}

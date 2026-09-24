// Block model for the visual builder. A report in visual mode stores this as `layout`
// in the .zrpt; the Handlebars `code` field is generated from it (see generate.ts),
// so the servers keep rendering plain templates.

export const LAYOUT_VERSION = 1;

export type Align = 'left' | 'center' | 'right';

export interface BlockStyle {
  align?: Align;
  /** px */
  fontSize?: number;
  bold?: boolean;
  color?: string;
  /** px */
  marginTop?: number;
  /** px */
  marginBottom?: number;
}

interface BaseBlock {
  id: string;
  style?: BlockStyle;
}

export interface TextBlock extends BaseBlock {
  type: 'text';
  tag: 'h1' | 'h2' | 'h3' | 'p';
  /** Literal text with optional {{field}} tokens. */
  text: string;
}

export interface FieldBlock extends BaseBlock {
  type: 'field';
  label: string;
  /** A data path like `customer.name`, or a template like `{{a}} / {{b}}`. */
  value: string;
}

export interface TableColumn {
  id: string;
  header: string;
  /** Path relative to the row (`price`), or a template (`{{qty}} × {{price}}`). */
  value: string;
  align?: Align;
  /** CSS width such as `20%` or `120px`. */
  width?: string;
}

export interface TableBlock extends BaseBlock {
  type: 'table';
  /** Path to the array to repeat over, e.g. `items`. */
  source: string;
  columns: TableColumn[];
  striped: boolean;
  bordered: boolean;
  headerBackground?: string;
  headerColor?: string;
  emptyText?: string;
}

export interface ImageBlock extends BaseBlock {
  type: 'image';
  assetId?: string;
  /** px; unset means natural size. */
  width?: number;
}

export interface DividerBlock extends BaseBlock {
  type: 'divider';
  color?: string;
  thickness?: number;
}

export interface SpacerBlock extends BaseBlock {
  type: 'spacer';
  height: number;
}

export type Block = TextBlock | FieldBlock | TableBlock | ImageBlock | DividerBlock | SpacerBlock;
export type BlockType = Block['type'];

export interface ReportLayout {
  version: number;
  blocks: Block[];
  /** The hand-written template this layout replaced, kept so switching to visual is reversible. */
  replacedCode?: string;
}

export const newId = () => Math.random().toString(36).slice(2, 10);

export function newBlock(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case 'text':
      return { id, type, tag: 'p', text: 'Text' };
    case 'field':
      return { id, type, label: 'Label', value: '' };
    case 'table':
      return { id, type, source: '', columns: [], striped: true, bordered: false, headerBackground: '#f0f0f0' };
    case 'image':
      return { id, type, width: 120 };
    case 'divider':
      return { id, type, color: '#cccccc', thickness: 1 };
    case 'spacer':
      return { id, type, height: 16 };
  }
}

// ---------- data schema ----------

export interface DataSchema {
  /** Dotted paths to scalar values, e.g. `customer.name`. */
  scalars: string[];
  /** Arrays of objects, with the scalar paths of their items. */
  arrays: { path: string; fields: string[] }[];
}

/** Field list for pickers, inferred from the sample data in the Data tab. */
export function inferSchema(data: unknown, maxDepth = 4): DataSchema {
  const schema: DataSchema = { scalars: [], arrays: [] };
  const walk = (value: unknown, prefix: string, depth: number) => {
    if (depth > maxDepth || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (!isPathSegment(key)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (Array.isArray(v)) {
        const first = v.find((x) => x !== null && typeof x === 'object' && !Array.isArray(x));
        if (first) schema.arrays.push({ path, fields: itemFields(first as Record<string, unknown>) });
      } else if (v !== null && typeof v === 'object') {
        walk(v, path, depth + 1);
      } else {
        schema.scalars.push(path);
      }
    }
  };
  walk(data, '', 0);
  return schema;
}

function itemFields(item: Record<string, unknown>, prefix = '', depth = 0): string[] {
  const out: string[] = [];
  for (const [key, v] of Object.entries(item)) {
    if (!isPathSegment(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && depth < 2) out.push(...itemFields(v as Record<string, unknown>, path, depth + 1));
    else if (!Array.isArray(v)) out.push(path);
  }
  return out;
}

const isPathSegment = (key: string) => /^[A-Za-z_$][\w$-]*$/.test(key);

export function humanize(path: string): string {
  const last = path.split('.').pop() ?? path;
  return last
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * A first layout built from the sample data: the report name as a heading, a field per
 * top-level value, and a table per array. Gives new reports something to edit immediately.
 */
export function starterLayout(title: string, data: unknown, replacedCode?: string): ReportLayout {
  const schema = inferSchema(data);
  const blocks: Block[] = [{ id: newId(), type: 'text', tag: 'h1', text: title || 'Report' }];
  const scalars = schema.scalars.filter((p) => !schema.arrays.some((a) => p.startsWith(`${a.path}.`)));
  for (const path of scalars) {
    blocks.push({ id: newId(), type: 'field', label: humanize(path), value: path });
  }
  for (const arr of schema.arrays) {
    blocks.push({ id: newId(), type: 'spacer', height: 12 });
    blocks.push({ id: newId(), type: 'text', tag: 'h2', text: humanize(arr.path) });
    blocks.push({
      id: newId(),
      type: 'table',
      source: arr.path,
      striped: true,
      bordered: false,
      headerBackground: '#f0f0f0',
      emptyText: 'No rows',
      columns: arr.fields.map((f) => ({ id: newId(), header: humanize(f), value: f })),
    });
  }
  return { version: LAYOUT_VERSION, blocks, replacedCode: replacedCode?.trim() ? replacedCode : undefined };
}

export function isLayout(value: unknown): value is ReportLayout {
  return !!value && typeof value === 'object' && Array.isArray((value as ReportLayout).blocks);
}

import { useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import {
  Align,
  Block,
  BlockStyle,
  BlockType,
  DataSchema,
  humanize,
  newBlock,
  newId,
  ReportLayout,
  TableBlock,
  TableColumn,
} from '../../builder/layout';

export interface BuilderProps {
  layout: ReportLayout | null;
  schema: DataSchema;
  dataError?: string;
  hasData: boolean;
  hasCode: boolean;
  /** Present when a layout was detached and can be re-attached. */
  detached?: { blocks: number; edited: boolean };
  assets: { id: string; data: string }[];
  selected?: string;
  /**
   * `label` names the undo step. Changes with the same `group` in quick succession
   * (typing in one field) merge into one step.
   */
  onChange(layout: ReportLayout, change: { label: string; group?: string }): void;
  onUndo(): void;
  onRedo(): void;
  onSelect(id: string | undefined): void;
  onStart(fromData: boolean): void;
  onDetach(): void;
  onReattach(): void;
  onRestore(): void;
  onOpenTab(tab: 'data' | 'assets'): void;
}

const PALETTE: { type: BlockType; label: string; hint: string }[] = [
  { type: 'text', label: 'Text', hint: 'Heading or paragraph; can include {{fields}}' },
  { type: 'field', label: 'Field', hint: 'Label and value from the data' },
  { type: 'table', label: 'Table', hint: 'One row per item in a list' },
  { type: 'image', label: 'Image', hint: 'An image from the Assets tab' },
  { type: 'divider', label: 'Divider', hint: 'Horizontal line' },
  { type: 'spacer', label: 'Spacer', hint: 'Vertical space' },
];

const TYPE_LABEL: Record<BlockType, string> = {
  text: 'Text', field: 'Field', table: 'Table', image: 'Image', divider: 'Divider', spacer: 'Spacer',
};

export function Builder(props: BuilderProps) {
  if (!props.layout) return <Start {...props} />;
  const { layout, selected } = props;
  const block = layout.blocks.find((b) => b.id === selected);

  const setBlocks = (blocks: Block[], label: string, group?: string) => props.onChange({ ...layout, blocks }, { label, group });
  /** `group`: a merge key for typing, false for one-off changes such as a checkbox. Defaults to block + fields. */
  const patch = (id: string, change: Partial<Block>, group?: string | false) => {
    const b = layout.blocks.find((x) => x.id === id);
    const key = group === false ? undefined : group ?? `${id}:${Object.keys(change).sort().join(',')}`;
    setBlocks(layout.blocks.map((x) => (x.id === id ? ({ ...x, ...change } as Block) : x)), `Edit ${b ? TYPE_LABEL[b.type] : 'block'}`, key);
  };

  const add = (type: BlockType) => {
    const b = newBlock(type);
    const at = selected ? layout.blocks.findIndex((x) => x.id === selected) + 1 : layout.blocks.length;
    const blocks = [...layout.blocks];
    blocks.splice(at, 0, b);
    setBlocks(blocks, `Add ${TYPE_LABEL[type]}`);
    props.onSelect(b.id);
  };

  return (
    <div class="rb-builder">
      <div class="rb-toolbar">
        <span class="rb-seg" role="group" aria-label="History">
          <button class="secondary" title="Undo (⌘Z / Ctrl+Z outside the code editors)" onClick={props.onUndo}>↶ Undo</button>
          <button class="secondary" title="Redo (⇧⌘Z / Ctrl+Y)" onClick={props.onRedo}>↷ Redo</button>
        </span>
        <span class="rb-toolbar-label">Add</span>
        {PALETTE.map((p) => (
          <button class="secondary" title={p.hint} onClick={() => add(p.type)}>
            + {p.label}
          </button>
        ))}
        <span class="spacer" />
        {layout.replacedCode && (
          <ConfirmButton label="Restore previous template" confirm="Discard layout and restore?" onConfirm={props.onRestore} />
        )}
        <ConfirmButton label="Detach to code" confirm="Edit this report as code. The layout is kept and can be re-attached from the Design tab." onConfirm={props.onDetach} />
      </div>
      {props.dataError && <div class="rb-banner warn">Data tab: {props.dataError}. Field suggestions are unavailable until it is valid JSON.</div>}
      <div class="rb-columns">
        <Outline layout={layout} selected={selected} onSelect={props.onSelect} onBlocks={setBlocks} />
        <div class="rb-inspector">
          {block ? (
            <Inspector key={block.id} block={block} props={props} patch={(c, g) => patch(block.id, c, g)} />
          ) : (
            <p class="hint">Select a block in the list or on the Live canvas to edit it.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- start screen ----------

function Start(props: BuilderProps) {
  if (props.detached) {
    const { blocks, edited } = props.detached;
    return (
      <div class="rb-start">
        <h3>Visual layout detached</h3>
        <p>
          This report is being edited as code. Its visual layout ({blocks} block{blocks === 1 ? '' : 's'}) was kept and can be
          re-attached.
        </p>
        {edited ? (
          <p class="rb-note">
            The template was changed by hand since detaching. Re-attaching regenerates it from the layout; your edited version is
            kept and can be brought back with <b>Restore previous template</b>.
          </p>
        ) : (
          <p class="hint">The template hasn't changed since detaching, so nothing is lost by re-attaching.</p>
        )}
        <div class="row">
          <button onClick={props.onReattach}>Re-attach visual layout</button>
        </div>
        <p class="hint">
          Or start over: <a onClick={() => props.onStart(true)}>new layout from sample data</a> ·{' '}
          <a onClick={() => props.onStart(false)}>blank layout</a>
        </p>
      </div>
    );
  }
  return (
    <div class="rb-start">
      <h3>Build this report visually</h3>
      <p>
        Add text, fields and tables bound to the sample data in the Data tab. The Handlebars template is generated for you and
        stays compatible with the report servers.
      </p>
      <div class="row">
        <button disabled={!props.hasData} onClick={() => props.onStart(true)}>
          Start from sample data
        </button>
        <button class="secondary" onClick={() => props.onStart(false)}>
          Start blank
        </button>
      </div>
      {!props.hasData && (
        <p class="hint">
          Add sample JSON in the <a onClick={() => props.onOpenTab('data')}>Data tab</a> to start with a layout built from it.
        </p>
      )}
      {props.dataError && <p class="hint">Data tab: {props.dataError}</p>}
      {props.hasCode && <p class="hint">Your current template is kept and can be restored from the Design tab.</p>}
    </div>
  );
}

// ---------- outline ----------

function Outline(p: { layout: ReportLayout; selected?: string; onSelect(id: string): void; onBlocks(b: Block[], label: string): void }) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const blocks = p.layout.blocks;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    const next = [...blocks];
    const [b] = next.splice(from, 1);
    next.splice(to, 0, b);
    p.onBlocks(next, `Move ${TYPE_LABEL[b.type]}`);
  };
  const remove = (i: number) => p.onBlocks(blocks.filter((_, j) => j !== i), `Delete ${TYPE_LABEL[blocks[i].type]}`);
  const duplicate = (i: number) => {
    const copy = structuredClone(blocks[i]);
    copy.id = newId();
    if (copy.type === 'table') copy.columns = copy.columns.map((c) => ({ ...c, id: newId() }));
    const next = [...blocks];
    next.splice(i + 1, 0, copy);
    p.onBlocks(next, `Duplicate ${TYPE_LABEL[copy.type]}`);
    p.onSelect(copy.id);
  };

  if (!blocks.length) return <div class="rb-outline"><p class="hint">Empty report. Add a block with the buttons above.</p></div>;

  return (
    <ol class="rb-outline">
      {blocks.map((b, i) => (
        <li
          key={b.id}
          class={[
            'rb-row',
            b.id === p.selected ? 'selected' : '',
            drag && drag.over === i && drag.from !== i ? (drag.from < i ? 'drop-after' : 'drop-before') : '',
          ].join(' ')}
          draggable
          onDragStart={(e) => {
            e.dataTransfer!.effectAllowed = 'move';
            e.dataTransfer!.setData('text/plain', b.id);
            setDrag({ from: i, over: i });
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (drag && drag.over !== i) setDrag({ ...drag, over: i });
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (drag) move(drag.from, i);
            setDrag(null);
          }}
          onDragEnd={() => setDrag(null)}
          onClick={() => p.onSelect(b.id)}
        >
          <span class="rb-grip" title="Drag to reorder">⠿</span>
          <span class="rb-type">{TYPE_LABEL[b.type]}</span>
          <span class="rb-summary">{summary(b)}</span>
          <span class="rb-actions" onClick={(e) => e.stopPropagation()}>
            <IconButton title="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>↑</IconButton>
            <IconButton title="Move down" disabled={i === blocks.length - 1} onClick={() => move(i, i + 1)}>↓</IconButton>
            <IconButton title="Duplicate" onClick={() => duplicate(i)}>⧉</IconButton>
            <IconButton title="Delete" onClick={() => remove(i)}>✕</IconButton>
          </span>
        </li>
      ))}
    </ol>
  );
}

function summary(b: Block): string {
  switch (b.type) {
    case 'text':
      return `${b.tag.toUpperCase()} · ${b.text.split('\n')[0] || '(empty)'}`;
    case 'field':
      return `${b.label}: ${b.value || '(no value)'}`;
    case 'table':
      return b.source ? `${b.source} · ${b.columns.length} column${b.columns.length === 1 ? '' : 's'}` : '(no data source)';
    case 'image':
      return b.assetId ? `asset ${b.assetId.slice(0, 8)}` : '(no image)';
    case 'divider':
      return `${b.thickness ?? 1}px`;
    case 'spacer':
      return `${b.height}px`;
  }
}

// ---------- inspector ----------

type Patch<B = Block> = (change: Partial<B>, group?: string | false) => void;

function Inspector({ block, props, patch }: { block: Block; props: BuilderProps; patch: Patch }) {
  const { schema } = props;
  return (
    <div class="rb-form">
      <h4>{TYPE_LABEL[block.type]}</h4>
      <datalist id="rb-scalars">{schema.scalars.map((s) => <option value={s} />)}</datalist>
      <datalist id="rb-arrays">{schema.arrays.map((a) => <option value={a.path} />)}</datalist>

      {block.type === 'text' && <TextFields block={block} schema={schema} patch={patch} />}

      {block.type === 'field' && (
        <>
          <Label text="Label">
            <input value={block.label} onInput={(e) => patch({ label: val(e) })} />
          </Label>
          <Label text="Value" hint="A data path, or a template such as {{first}} {{last}}">
            <input list="rb-scalars" value={block.value} placeholder="customer.name"
              onInput={(e) => {
                const value = val(e);
                const label = block.label === 'Label' || block.label === humanize(block.value) ? humanize(value) : block.label;
                patch({ value, label });
              }} />
          </Label>
        </>
      )}

      {block.type === 'table' && <TableFields block={block} schema={schema} patch={patch} />}

      {block.type === 'image' && (
        <>
          {props.assets.length ? (
            <div class="rb-assets">
              {props.assets.map((a) => (
                <button class={`rb-asset ${a.id === block.assetId ? 'selected' : ''}`} title={a.id} onClick={() => patch({ assetId: a.id }, false)}>
                  <img src={a.data} alt="" />
                </button>
              ))}
            </div>
          ) : (
            <p class="hint">No images yet. Add some in the <a onClick={() => props.onOpenTab('assets')}>Assets tab</a>.</p>
          )}
          <Label text="Width (px)">
            <NumberInput value={block.width} onValue={(width) => patch({ width })} />
          </Label>
        </>
      )}

      {block.type === 'divider' && (
        <div class="rb-grid2">
          <Label text="Color"><ColorInput value={block.color} onValue={(color) => patch({ color })} /></Label>
          <Label text="Thickness (px)"><NumberInput value={block.thickness} onValue={(thickness) => patch({ thickness })} /></Label>
        </div>
      )}

      {block.type === 'spacer' && (
        <Label text="Height (px)">
          <NumberInput value={block.height} onValue={(height) => patch({ height: height ?? 0 })} />
        </Label>
      )}

      {block.type !== 'spacer' && (
        <StyleFields
          style={block.style}
          onStyle={(style, key) => patch({ style }, key ? `${block.id}:style:${key}` : false)}
          textOptions={block.type !== 'divider' && block.type !== 'image'}
        />
      )}
    </div>
  );
}

function TextFields({ block, schema, patch }: { block: Extract<Block, { type: 'text' }>; schema: DataSchema; patch: Patch }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (path: string) => {
    const el = ref.current;
    const token = `{{${path}}}`;
    const at = el ? el.selectionStart : block.text.length;
    const end = el ? el.selectionEnd : at;
    patch({ text: block.text.slice(0, at) + token + block.text.slice(end) }, false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  return (
    <>
      <Label text="Kind">
        <select value={block.tag} onChange={(e) => patch({ tag: val(e) as typeof block.tag }, false)}>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="p">Paragraph</option>
        </select>
      </Label>
      <Label text="Text" hint="Use {{path}} to insert a value from the data">
        <textarea ref={ref} rows={3} value={block.text} onInput={(e) => patch({ text: val(e) })} />
      </Label>
      {schema.scalars.length > 0 && (
        <Label text="Insert field">
          <select value="" onChange={(e) => { if (val(e)) insert(val(e)); (e.target as HTMLSelectElement).value = ''; }}>
            <option value="">Choose a field…</option>
            {schema.scalars.map((s) => <option value={s}>{s}</option>)}
          </select>
        </Label>
      )}
    </>
  );
}

function TableFields({ block, schema, patch }: { block: TableBlock; schema: DataSchema; patch: Patch<TableBlock> }) {
  const itemFields = schema.arrays.find((a) => a.path === block.source)?.fields ?? [];
  const setColumns = (columns: TableColumn[], group?: string) => patch({ columns }, group ?? false);
  /** Typing in a column's input merges per column and field; picking from a select doesn't. */
  const setCol = (i: number, c: Partial<TableColumn>, typed = true) =>
    setColumns(
      block.columns.map((col, j) => (j === i ? { ...col, ...c } : col)),
      typed ? `${block.id}:col:${block.columns[i].id}:${Object.keys(c).sort().join(',')}` : undefined,
    );
  const moveCol = (i: number, to: number) => {
    if (to < 0 || to >= block.columns.length) return;
    const next = [...block.columns];
    const [c] = next.splice(i, 1);
    next.splice(to, 0, c);
    setColumns(next);
  };
  const missing = itemFields.filter((f) => !block.columns.some((c) => c.value === f));

  return (
    <>
      <Label text="Rows from" hint="The list in your data to repeat, one row per item">
        {schema.arrays.length ? (
          <select value={block.source} onChange={(e) => {
            const source = val(e);
            const fields = schema.arrays.find((a) => a.path === source)?.fields ?? [];
            // Picking a list for an empty table fills in its columns.
            const columns = block.columns.length ? block.columns : fields.map((f) => ({ id: newId(), header: humanize(f), value: f }));
            patch({ source, columns }, false);
          }}>
            <option value="">Choose a list…</option>
            {schema.arrays.map((a) => <option value={a.path}>{a.path} ({a.fields.length} fields)</option>)}
            {block.source && !schema.arrays.some((a) => a.path === block.source) && <option value={block.source}>{block.source}</option>}
          </select>
        ) : (
          <input list="rb-arrays" value={block.source} placeholder="items" onInput={(e) => patch({ source: val(e) })} />
        )}
      </Label>

      <div class="rb-subhead">
        <span>Columns</span>
        <span class="spacer" />
        <button class="secondary small" onClick={() => setColumns([...block.columns, { id: newId(), header: 'Column', value: '' }])}>+ Column</button>
        {missing.length > 0 && (
          <button class="secondary small" onClick={() => setColumns([...block.columns, ...missing.map((f) => ({ id: newId(), header: humanize(f), value: f }))])}>
            + All fields
          </button>
        )}
      </div>
      <datalist id={`rb-item-${block.id}`}>{itemFields.map((f) => <option value={f} />)}</datalist>
      {block.columns.length === 0 && <p class="hint">No columns yet.</p>}
      <div class="rb-cols">
        {block.columns.map((c, i) => (
          <div class="rb-col" key={c.id}>
            <input class="rb-col-header" value={c.header} placeholder="Header" title="Header" onInput={(e) => setCol(i, { header: val(e) })} />
            <input class="rb-col-value" list={`rb-item-${block.id}`} value={c.value} placeholder="field" title="Value: a field of each row, or a template"
              onInput={(e) => {
                const value = val(e);
                const header = c.header === 'Column' || c.header === humanize(c.value) ? humanize(value) : c.header;
                setCol(i, { value, header });
              }} />
            <select class="rb-col-align" value={c.align ?? 'left'} title="Alignment" onChange={(e) => setCol(i, { align: val(e) as Align }, false)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
            <input class="rb-col-width" value={c.width ?? ''} placeholder="auto" title="Width, e.g. 20% or 80px" onInput={(e) => setCol(i, { width: val(e) || undefined })} />
            <span class="rb-actions">
              <IconButton title="Move left" disabled={i === 0} onClick={() => moveCol(i, i - 1)}>↑</IconButton>
              <IconButton title="Move right" disabled={i === block.columns.length - 1} onClick={() => moveCol(i, i + 1)}>↓</IconButton>
              <IconButton title="Remove column" onClick={() => setColumns(block.columns.filter((_, j) => j !== i))}>✕</IconButton>
            </span>
          </div>
        ))}
      </div>

      <div class="rb-grid2">
        <Check label="Striped rows" checked={block.striped} onValue={(striped) => patch({ striped }, false)} />
        <Check label="Cell borders" checked={block.bordered} onValue={(bordered) => patch({ bordered }, false)} />
        <Label text="Header background"><ColorInput value={block.headerBackground} onValue={(headerBackground) => patch({ headerBackground })} /></Label>
        <Label text="Header text"><ColorInput value={block.headerColor} onValue={(headerColor) => patch({ headerColor })} /></Label>
      </div>
      <Label text="When the list is empty">
        <input value={block.emptyText ?? ''} placeholder="(show nothing)" onInput={(e) => patch({ emptyText: val(e) || undefined })} />
      </Label>
    </>
  );
}

function StyleFields({ style = {}, onStyle, textOptions }: { style?: BlockStyle; onStyle(s: BlockStyle, typedKey?: string): void; textOptions: boolean }) {
  /** Typed values merge per property; toggles and buttons are one step each. */
  const set = (c: Partial<BlockStyle>, typed = true) => onStyle({ ...style, ...c }, typed ? Object.keys(c)[0] : undefined);
  return (
    <>
      <div class="rb-subhead"><span>Style</span></div>
      <div class="rb-grid2">
        <Label text="Align">
          <div class="rb-seg">
            {(['left', 'center', 'right'] as Align[]).map((a) => (
              <button class={(style.align ?? 'left') === a ? 'active' : 'secondary'} onClick={() => set({ align: a }, false)}>
                {a[0].toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
        </Label>
        {textOptions && (
          <Label text="Font size (px)"><NumberInput value={style.fontSize} onValue={(fontSize) => set({ fontSize })} /></Label>
        )}
        {textOptions && <Label text="Color"><ColorInput value={style.color} onValue={(color) => set({ color })} /></Label>}
        {textOptions && <Check label="Bold" checked={!!style.bold} onValue={(bold) => set({ bold }, false)} />}
        <Label text="Space above (px)"><NumberInput value={style.marginTop} onValue={(marginTop) => set({ marginTop })} /></Label>
        <Label text="Space below (px)"><NumberInput value={style.marginBottom} onValue={(marginBottom) => set({ marginBottom })} /></Label>
      </div>
    </>
  );
}

// ---------- small controls ----------

const val = (e: JSX.TargetedEvent<HTMLElement, Event>) => (e.currentTarget as HTMLInputElement).value;

function Label({ text, hint, children }: { text: string; hint?: string; children: ComponentChildren }) {
  return (
    <label class="rb-label">
      <span>{text}</span>
      {children}
      {hint && <small class="hint">{hint}</small>}
    </label>
  );
}

function Check({ label, checked, onValue }: { label: string; checked: boolean; onValue(v: boolean): void }) {
  return (
    <label class="rb-check">
      <input type="checkbox" checked={checked} onChange={(e) => onValue((e.currentTarget as HTMLInputElement).checked)} />
      {label}
    </label>
  );
}

function NumberInput({ value, onValue }: { value?: number; onValue(v: number | undefined): void }) {
  return (
    <input type="number" min={0} value={value ?? ''} placeholder="auto"
      onInput={(e) => {
        const raw = val(e);
        onValue(raw === '' ? undefined : Math.max(0, Number(raw)));
      }} />
  );
}

function ColorInput({ value, onValue }: { value?: string; onValue(v: string | undefined): void }) {
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <span class="rb-color">
      <input type="color" value={hex} onInput={(e) => onValue(val(e))} />
      <input value={value ?? ''} placeholder="default" onInput={(e) => onValue(val(e) || undefined)} />
    </span>
  );
}

function IconButton({ title, disabled, onClick, children }: { title: string; disabled?: boolean; onClick(): void; children: string }) {
  return (
    <button class="rb-icon" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** Webviews can't show confirm(), so destructive actions take a second click. */
function ConfirmButton({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm(): void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number>();
  return (
    <button
      class={armed ? 'danger' : 'secondary'}
      title={confirm}
      onClick={() => {
        if (armed) {
          clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
          return;
        }
        setArmed(true);
        timer.current = window.setTimeout(() => setArmed(false), 3000);
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? 'Click again to confirm' : label}
    </button>
  );
}

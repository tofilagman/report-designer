// Webview bundle for the visual builder, exposed as window.ReportBuilder for designer.js.
import { render } from 'preact';
import { generateTemplate } from '../../builder/generate';
import { inferSchema, isLayout, ReportLayout, starterLayout } from '../../builder/layout';
import { Builder, BuilderProps } from './Builder';
import { createCanvas } from './canvas';

type HandlerKeys = 'onChange' | 'onSelect' | 'onStart' | 'onDetach' | 'onReattach' | 'onRestore' | 'onOpenTab' | 'onUndo' | 'onRedo';
type State = Omit<BuilderProps, HandlerKeys>;
type Handlers = Pick<BuilderProps, HandlerKeys>;

function mountBuilder(el: HTMLElement, handlers: Handlers) {
  let state: State = { layout: null, schema: { scalars: [], arrays: [] }, hasData: false, hasCode: false, assets: [] };
  const draw = () => render(<Builder {...state} {...handlers} />, el);
  draw();
  return {
    update(next: Partial<State>) {
      state = { ...state, ...next };
      draw();
    },
  };
}

/** Parses the Data tab text for the builder's field pickers. */
function readData(text: string): { data?: unknown; error?: string } {
  if (!text.trim()) return {};
  try {
    return { data: JSON.parse(text) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

const api = { mountBuilder, createCanvas, generateTemplate, starterLayout, inferSchema, isLayout, readData };
(window as unknown as { ReportBuilder: typeof api }).ReportBuilder = api;
export type { ReportLayout };

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Handlebars from 'handlebars';
import { generateTemplate, template, value } from '../src/builder/generate';
import { inferSchema, newBlock, ReportLayout, starterLayout, TableBlock } from '../src/builder/layout';

const invoice = {
  number: 'INV-0042',
  customer: { name: 'Acme & Sons', email: 'a@acme.test' },
  total: '61.00',
  items: [
    { name: 'Widget', qty: 2, price: '10.00' },
    { name: '<Gadget>', qty: 1, price: '25.50' },
  ],
};

const render = (layout: ReportLayout, data: unknown, annotate = false) =>
  Handlebars.create().compile(generateTemplate(layout, { annotate }))(data);

test('schema lists scalar paths and arrays with their item fields', () => {
  const s = inferSchema(invoice);
  assert.deepEqual(s.scalars, ['number', 'customer.name', 'customer.email', 'total']);
  assert.deepEqual(s.arrays, [{ path: 'items', fields: ['name', 'qty', 'price'] }]);
});

test('starter layout renders every value and every row', () => {
  const html = render(starterLayout('Invoice', invoice), invoice);
  assert.match(html, /<h1>Invoice<\/h1>/);
  assert.match(html, /<span class="rb-label">Customer<\/span>|<span class="rb-label">Name<\/span>/);
  assert.match(html, /Acme &amp; Sons/);
  assert.equal(html.match(/<tbody>[\s\S]*?<\/tbody>/)![0].match(/<tr>/g)!.length, 2);
  // Values are escaped by Handlebars, not trusted.
  assert.match(html, /&lt;Gadget&gt;/);
});

test('empty arrays show the empty text', () => {
  const layout = starterLayout('R', invoice);
  const html = render(layout, { ...invoice, items: [] });
  assert.match(html, /class="rb-empty" colspan="3">No rows</);
});

test('literal text is escaped but {{tokens}} stay live', () => {
  assert.equal(template('a < b {{x}} & {{{raw}}}'), 'a &lt; b {{x}} &amp; {{{raw}}}');
  assert.equal(value('customer.name'), '{{customer.name}}');
  assert.equal(value('{{qty}} x {{price}}'), '{{qty}} x {{price}}');
  assert.equal(value('Hello world'), 'Hello world');
  const layout: ReportLayout = { version: 1, blocks: [{ id: 't', type: 'text', tag: 'p', text: 'Total <b>: {{total}}\nThanks' }] };
  assert.equal(render(layout, invoice).trim().split('\n').pop(), '<p>Total &lt;b&gt;: 61.00<br>Thanks</p>');
});

test('annotate adds block ids and placeholders; saved code has neither', () => {
  const layout: ReportLayout = { version: 1, blocks: [newBlock('table'), newBlock('image'), { id: 'h', type: 'text', tag: 'h2', text: 'Hi' }] };
  const saved = generateTemplate(layout);
  const canvas = generateTemplate(layout, { annotate: true });
  assert.doesNotMatch(saved, /data-rb|rb-placeholder">/);
  assert.match(canvas, /data-rb="h"/);
  assert.equal(canvas.match(/class="rb-placeholder"/g)?.length, 2);
});

test('table options produce CSS, widths and alignment', () => {
  const t: TableBlock = {
    id: 'abc', type: 'table', source: 'items', striped: true, bordered: true, headerBackground: '#123456', headerColor: 'white',
    columns: [
      { id: '1', header: 'Item', value: 'name', width: '60%' },
      { id: '2', header: 'Amount', value: '{{qty}} × {{price}}', align: 'right' },
    ],
  };
  const code = generateTemplate({ version: 1, blocks: [t] });
  assert.match(code, /\.rb-t-abc th \{ background:#123456; color:white; \}/);
  assert.match(code, /\.rb-t-abc th, \.rb-t-abc td \{ border: 1px solid #ccc; \}/);
  assert.match(code, /<col style="width:60%"><col>/);
  const html = Handlebars.create().compile(code)(invoice);
  assert.match(html, /<td style="text-align:right">2 × 10.00<\/td>/);
});

test('unsafe style values are dropped', () => {
  const layout: ReportLayout = {
    version: 1,
    blocks: [{ id: 'x', type: 'text', tag: 'p', text: 'x', style: { color: 'red;background:url(evil)' } }],
  };
  assert.doesNotMatch(generateTemplate(layout), /evil/);
});

const path = require('path');
const loader = require('@monaco-editor/loader').default;
const { AppEventService, EventData } = require('./scripts/event-service');

function ensureFirstBackSlash(str) {
  return str.length > 0 && str.charAt(0) !== '/'
    ? '/' + str
    : str;
}

function uriFromPath(_path) {
  const pathName = path.resolve(_path).replace(/\\/g, '/');
  return encodeURI('file://' + ensureFirstBackSlash(pathName));
}

loader.config({
  paths: {
    vs: uriFromPath(
      path.join(__dirname, '../node_modules/monaco-editor/min/vs')
    )
  }
});

loader.init().then(monaco => {
  const editorOptions = { theme: 'vs-dark', language: 'html', automaticLayout: true };

  const codeEditor = monaco.editor.create(document.getElementById('code-designer'), editorOptions);
  const dataEditor = monaco.editor.create(document.getElementById('data-designer'), {
    language: 'json',
    automaticLayout: true
  });
  const styleEditor = monaco.editor.create(document.getElementById('style-designer'), { ...this.editorOptions, language: 'css' });
  const scriptEditor = monaco.editor.create(document.getElementById('script-designer'), { ...this.editorOptions, language: 'javascript' });


  const resizeObserver = new ResizeObserver(() => {
    codeEditor.layout();
    dataEditor.layout();
    styleEditor.layout();
    scriptEditor.layout();
  });

  resizeObserver.observe(document.querySelector('.inner-content'));
});


window['WebPdfViewer'] = new AppEventService();
window['WebPdfViewer'].subscribe((ev, obj) => {
  window.pdf = obj;
  //this.pdf.open(this.xval);
});



const path = require('path');
const loader = require('@monaco-editor/loader').default;
const $ = window.jQuery = require('jquery');
const puppeteer = require('puppeteer-core').default;
const fs = require('fs');
const lz = require('lz-string');
const { AppEventService, EventData } = require('./scripts/event-service');
const { ipcRenderer } = require('electron');


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

let editors = {
  code: null,
  data: null,
  style: null,
  script: null
}

const OrientationTypes = [
  { id: 1, name: "Portrait" },
  { id: 0, name: "Landscape" }
];

let projectPath = null;

const DocumentTypes = [
  { id: 0, name: "A0" },
  { id: 1, name: "A1" },
  { id: 2, name: "A2" },
  { id: 3, name: "A3" },
  { id: 4, name: "A4" },
  { id: 5, name: "A5" },
  { id: 6, name: "A6" },
  { id: 28, name: "Letter" },
  { id: 27, name: "Legal" },
  { id: 29, name: "Tabloid" },
  { id: 26, name: "Ledger" }
];

const scriptInitData = `
Handlebars.registerHelper('currentDate', function () {
  return moment().format("MMM Do YY"); 
});

/**
 * use for custom data execution
 * dont remove
 */
function appScript(){
    
}
  `;

loader.init().then(monaco => {
  const editorOptions = { theme: 'vs-dark', language: 'html', automaticLayout: true };
  editors = {
    code: monaco.editor.create(document.getElementById('code-designer'), editorOptions),
    data: monaco.editor.create(document.getElementById('data-designer'), {
      language: 'json',
      automaticLayout: true
    }),
    style: monaco.editor.create(document.getElementById('style-designer'), { ...this.editorOptions, language: 'css' }),
    script: monaco.editor.create(document.getElementById('script-designer'), { ...this.editorOptions, language: 'javascript', value: scriptInitData })
  }

  const resizeObserver = new ResizeObserver(() => {
    editors.code.layout();
    editors.data.layout();
    editors.style.layout();
    editors.script.layout();
  });

  resizeObserver.observe(document.querySelector('.inner-content'));
});


window['WebPdfViewer'] = new AppEventService();
window['WebPdfViewer'].subscribe((ev, obj) => {
  window.pdf = obj;
});

// logic starts here
(function () {
  const aTitle = $('#app-title');
  const fort = $('#fort');
  const ford = $('#ford');
  const fname = $('#fname');
  const mleft = $('#mleft');
  const mright = $('#mright');
  const mtop = $('#mtop');
  const mbottom = $('#mbottom');

  $.each(OrientationTypes, (idx, itm) => { fort.append(new Option(itm.name, itm.id)); });
  $.each(DocumentTypes, (idx, itm) => { ford.append(new Option(itm.name, itm.id)); });
  fname.on('change', () => {
    aTitle.text(fname.val());
  });

  $('.app-btn').on('click', (ev) => {
    ev.preventDefault();

    switch ($(ev.target).prop('id')) {
      case 'btn-preview':
        render();
        break;
      case 'btn-create':
        create();
        break;
      case 'btn-open':
        open();
        break;
      case 'btn-save':
        save();
        break;
    }

  });



  const render = async () => {
    try {
      const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome-stable',
        headless: true, args: ["--no-sandbox"]
      });
      const page = await browser.newPage();

      const default_style = `
    body {
        font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,'Open Sans','Helvetica Neue',sans-serif;
    } 
  `;

      await page.setContent(`
      <style id='def-style'>
          ${default_style}
      </style>
      <body></body>
    `);

      const code = editors.code.getValue();
      const data = editors.data.getValue();
      const style = editors.style.getValue();
      const script = editors.script.getValue();

      if (isNotNullorEmpty(code))
        await page.addScriptTag({ id: 'entry-template', type: 'text/x-handlebars-template', content: code });
      else
        throw new Error('Add some code!');

      if (isNotNullorEmpty(style))
        await page.addScriptTag({ id: 'style-template', type: 'text/x-handlebars-template', content: style });

      await page.addScriptTag({ type: 'text/javascript', content: readPuppeteerContent('handlebars.min-v4.7.8.js') });
      await page.addScriptTag({ type: 'text/javascript', content: readPuppeteerContent('moment.min.js') });
      // await page.addScriptTag({ type: 'text/javascript', content: readPuppeteerContent('chart.min-v2.7.2.js') });

      if (isNotNullorEmpty(data))
        await page.addScriptTag({ type: 'text/javascript', content: `window.processContext = ${data}` });

      if (isNotNullorEmpty(script))
        await page.addScriptTag({ type: 'text/javascript', content: script });

      await page.addScriptTag({ type: 'text/javascript', content: readPuppeteerContent('Processor.js') });

      //await page.setViewport({ deviceScaleFactor: 1 });
      await page.setJavaScriptEnabled(true);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const pageTitle = await page.evaluate(() => {
        return window.processHandlebar();
      });
      console.log(`ready: ${pageTitle}`);

      const formData = getForm();

      const pdfdata = await page.pdf({
        format: formData.documentType,
        landscape: formData.landscape,
        printBackground: true,
        margin: {
          top: formData.margin.top,
          left: formData.margin.left,
          right: formData.margin.right,
          bottom: formData.margin.bottom
        }
      });

      const base64String = uint8ToBase64(pdfdata);
      const baseData = `data:application/pdf;base64,${base64String}`;

      window.pdf.open(baseData);
    } catch (ex) {
      alert(ex.message);
    }
  }

  const create = async () => {
    const mc = confirm('Create a new Project?');
    if (mc) {
      initForm();
      editors.code.setValue('');
      editors.data.setValue('');
      editors.style.setValue('');
      editors.script.setValue(scriptInitData);
      projectPath = null;
    }
  }

  const save = async () => {
    const form = {
      ...getForm(),
      code: editors.code.getValue(),
      data: editors.data.getValue(),
      style: editors.style.getValue(),
      script: editors.script.getValue()
    }

    const fdata = lz.compressToBase64(JSON.stringify(form));

    if (projectPath != null) {
      fs.writeFileSync(projectPath, fdata, 'utf-8');
    } else {
      const result = await ipcRenderer.invoke('save-file');
      if (result) {
        const ext = path.extname(result) || '.zrpt';
        const filename = path.parse(result);
        const fnmaa = path.join(filename.dir, filename.name + ext);
        fs.writeFileSync(fnmaa, fdata, 'utf-8');
        projectPath = fnmaa;
      }
    }
  }

  const open = async () => {
    try {
      const result = await ipcRenderer.invoke('open-file');
      if (result) {
        const npc = result[0];
        if (path.extname(npc) != '.zrpt') {
          throw new Error('Invalid Z Report file, accepts .zrpt files only');
        }

        const nc = fs.readFileSync(npc, 'utf-8');
        const fdata = JSON.parse(lz.decompressFromBase64(nc));
 
        aTitle.text(fdata.name);
        fort.val(fdata.landscape ? 0 : 1);
        ford.val(DocumentTypes.find(x=> x.name == fdata.documentType).id);
        fname.val(fdata.name);
        mleft.val(fdata.margin.left);
        mright.val(fdata.margin.right);
        mtop.val(fdata.margin.top);
        mbottom.val(fdata.margin.bottom);
        editors.code.setValue(fdata.code);
        editors.data.setValue(fdata.data);
        editors.style.setValue(fdata.style);
        editors.script.setValue(fdata.script);

        projectPath = npc;
      }
    } catch (ex) {
      alert(ex.message);
    }
  };

  const initForm = () => {
    const ntc = crypto.randomUUID();
    const mgn = `PDF Template ${ntc.substring(0, 5)}`

    aTitle.text(mgn);
    fort.val(1);
    ford.val(4);
    fname.val(mgn);
    mleft.val(20);
    mright.val(20);
    mtop.val(20);
    mbottom.val(20);
  }

  const getForm = () => {
    return {
      name: fname.val(),
      landscape: parseInt(fort.val()) == 0,
      documentType: DocumentTypes.find(x => x.id == parseInt(ford.val())).name,
      margin: {
        left: mleft.val() || 20,
        right: mright.val() || 20,
        top: mtop.val() || 20,
        bottom: mbottom.val() || 20
      }
    }
  }

  initForm();
}())


const isNullorEmpty = (data) => {
  return data == null || data == undefined || data == ''
}

const isNotNullorEmpty = (data) => {
  return !isNullorEmpty(data);
}

const readPuppeteerContent = (name) => {
  return fs.readFileSync(path.join(__dirname, `libs/puppeteer-content/${name}`), 'utf-8');
}

const uint8ToBase64 = (arr) => {
  return btoa(
    String.fromCharCode.apply(null, arr)
  );
};
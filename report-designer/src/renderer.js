const path = require('path');
const loader = require('@monaco-editor/loader').default;
const $ = window.jQuery = require('jquery');
const puppeteer = require('puppeteer-core').default;
const fs = require('fs');
const lz = require('lz-string');
const { AppEventService, EventData } = require('./scripts/event-service');
const { ipcRenderer } = require('electron');
const { randomUUID } = require('crypto');
const { BSON, EJSON } = require('bson');
const axios = require('axios');


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

let assets = [];

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
  const fdepUrl = $('#fdepaddr');

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
      case 'btn-save-as':
        save($(ev.target).prop('id') == 'btn-save-as');
        break;
      case 'btn-test-connect':
        testConnectToServer();
        break;
      case 'btn-publish':
        publish();
        break;
      case 'btn-sync-lib':
        syncLib();
        break;
    }
  });

  $('.app-btn-resource').on('click', (ev) => {
    ev.preventDefault();

    let aa = $(ev.target);
    if (['svg', 'path'].indexOf($(ev.target).prop('nodeName')) !== -1) {
      aa = $(ev.target).closest('button');
    }

    switch (aa.prop('id')) {
      case 'btn-resource-add':
        addResource();
        break;
      case 'btn-resource-apply':
        console.log('apply');
        break;
      case 'btn-resource-delete':
        console.log('delete');
        break
    }
  });

  $('.nav-link').on('click', (ev) => {
    ev.preventDefault();
    switch ($(ev.target).prop('id')) {
      case 'home-tab':
        editors.code.layout();
        break;
      case 'profile-tab':
        editors.data.layout();
        break;
      case 'contact-tab':
        editors.style.layout();
        break
      case 'disabled-tab':
        editors.script.layout();
        break
    }
  });


  const render = async () => {
    try {
      const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_PATH,
        headless: true, args: ["--no-sandbox"]
      });
      const page = await browser.newPage();

      // Catch console messages
      page.on('console', async msg => {
        const args = await Promise.all(msg.args().map(arg =>
          arg.executionContext().evaluate(arg => {
            if (arg instanceof Error) return arg.message;
            return arg;
          }, arg)
        ));
        console.log(...args);
      });

      // Catch page errors
      page.on('pageerror', err => {
        console.error(`Page error: ${err.toString()}`);
      });

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
 
      const files = fs.readdirSync(process.env.LIBS); 
      const jsLibs = files.filter(file => path.extname(file) === '.js');
      for (var js of jsLibs) {
        if(js.toLowerCase() == "processor.js") continue;
        await page.addScriptTag({ type: 'text/javascript', content: readLibContent(js) });
      }
     
      if (isNotNullorEmpty(data))
        await page.addScriptTag({ type: 'text/javascript', content: `window.processContext = ${data}` });

      if (assets.length > 0) {
        const ass = {};
        for (let g of assets) {
          ass[g.id] = g.data;
        }
        await page.addScriptTag({ type: "text/javascript", content: `window.resourceContext = ${JSON.stringify(ass)}` });
      }

      if (isNotNullorEmpty(script))
        await page.addScriptTag({ type: 'text/javascript', content: script });

      await page.addScriptTag({ type: 'text/javascript', content: readLibContent('Processor.js') });

      //await page.setViewport({ deviceScaleFactor: 1 });
      await page.setJavaScriptEnabled(true);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      // const gg = await page.content();
      // fs.writeFileSync('smaple.html', gg);

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
      console.error(ex);
      await msgBox(ex.toString());
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
      assets = [];
      replenishAssets();
    }
  }

  const save = async (saveAs, suppressNotification) => {
    const form = {
      ...getForm(),
      code: editors.code.getValue(),
      data: editors.data.getValue(),
      style: editors.style.getValue(),
      script: editors.script.getValue(),
      assets: assets || [],
    }

    const fdata = BSON.serialize(form);

    if (projectPath != null && !saveAs) {
      fs.writeFileSync(projectPath, fdata);
      if (suppressNotification)
        return;
      await msgBox('Project has been saved!');
    } else {
      const result = await ipcRenderer.invoke('save-file');
      if (result) {
        const ext = path.extname(result) || '.zrpt';
        const filename = path.parse(result);
        const fnmaa = path.join(filename.dir, filename.name + ext);
        fs.writeFileSync(fnmaa, fdata);
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

        const nc = fs.readFileSync(npc);
        const fdata = BSON.deserialize(nc);

        aTitle.text(fdata.name);
        fort.val(fdata.landscape ? 0 : 1);
        ford.val(DocumentTypes.find(x => x.name == fdata.documentType).id);
        fname.val(fdata.name);
        mleft.val(fdata.margin.left);
        mright.val(fdata.margin.right);
        mtop.val(fdata.margin.top);
        mbottom.val(fdata.margin.bottom);
        editors.code.setValue(fdata.code);
        editors.data.setValue(fdata.data);
        editors.style.setValue(fdata.style);
        editors.script.setValue(fdata.script);

        fdepUrl.val(fdata.deploymentUrl);
        assets = fdata.assets || [];
        projectPath = npc;

        replenishAssets();
      }
    } catch (ex) {
      await msgBox(ex.message);
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
    fdepUrl.val("http://localhost:8088");
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
      },
      deploymentUrl: fdepUrl.val() || null
    }
  }

  const addResource = async () => {
    try {
      const result = await ipcRenderer.invoke('open-resource-file');
      if (result) {
        for (let npc of result) {

          const mfile = fs.readFileSync(npc);
          const base64 = mfile.toString('base64');

          const dataUri = `data:image/${path.extname(npc).slice(1)};base64,${base64}`;

          assets.push({
            data: dataUri,
            id: randomUUID()
          });
        }

        replenishAssets();
      }
    } catch (ex) {
      await msgBox(ex.message);
    }
  }

  const testConnectToServer = async () => {
    try {
      const url = fdepUrl.val();

      if (isNullorEmpty(url))
        throw new Error('Deployment url is not defined');

      const instance = axios.create({
        baseURL: url
      });

      showLoading('Test connection');

      await instance.get('/template');

      await msgBox('Connected');
    } catch (ex) {
      await msgBox(ex.message);
    } finally {
      hideLoading();
    }
  }

  const syncLib = async () => {
     try { 
      const url = fdepUrl.val();

      if (isNullorEmpty(url))
        throw new Error('Deployment url is not defined');
 
      showLoading('Synchronizing Libraries');

      await ipcRenderer.invoke('syncLib', url);

      await msgBox('Completed');
    } catch (ex) {
      await msgBox(ex.message);
    } finally {
      hideLoading();
    }
  }

  const publish = async () => {
    try {
      if (isNullorEmpty(projectPath))
        throw new Error('Save the project first!');

      const url = fdepUrl.val();

      if (isNullorEmpty(url))
        throw new Error('Deployment url is not defined');

      //save first
      await save(false, true);

      showLoading('Publishing');

      await ipcRenderer.invoke('upload', url, '/template/publish', projectPath);

      await msgBox('Completed');
    } catch (ex) {
      await msgBox(ex.message);
    } finally {
      hideLoading();
    }
  }

  initForm();
}())

ipcRenderer.on('upload-progress', (ev, args) => {
  console.log(args);
})

const isNullorEmpty = (data) => {
  return data == null || data == undefined || data == ''
}

const isNotNullorEmpty = (data) => {
  return !isNullorEmpty(data);
}

const readPuppeteerContent = (name) => {
  return fs.readFileSync(path.join(__dirname, `libs/puppeteer-content/${name}`), 'utf-8');
}

const readLibContent = (name) => {
  return fs.readFileSync(path.join(process.env.LIBS, name), 'utf-8');
}

const uint8ToBase64 = (arr) => {
  const buffer = Buffer.from(arr);
  return buffer.toString("base64");
};

const replenishAssets = () => {
  const container = $('.app-img-container');
  container.empty();

  for (let aa of assets) {
    container.append(assetItem(aa));
  }

  $('.app-btn-resource', container).on('click', async (ev) => {
    ev.preventDefault();

    let aa = $(ev.target);
    if (['svg', 'path'].indexOf($(ev.target).prop('nodeName')) !== -1) {
      aa = $(ev.target).closest('button');
    }

    const uid = aa.attr('uid');

    switch (aa.prop('id')) {
      case 'btn-resource-apply':
        await ipcRenderer.invoke('clipboard', `{{resource '${uid}'}}`);
        await msgBox('Resource has been copied to clipboard');
        break;
      case 'btn-resource-delete':
        const rr = confirm('Delete this resource?');
        if (rr) {
          for (var i = assets.length - 1; i >= 0; --i) {
            if (assets[i].id == uid) {
              assets.splice(i, 1);
            }
          }
          $(`.app-img-item[uid=${uid}]`).remove();
        }
        break
    }
  });
}

const assetItem = (item) => {
  return $(`
    <div class="app-img-item col-md-3 mb-3" uid="${item.id}">
        <img src="${item.data}" class="img-thumbnail rounded mx-auto" alt="...">
        <div class="img-action-group">
            <button uid="${item.id}" class="app-btn-resource btn btn-secondary" id="btn-resource-apply" href="javascript:;"><i class="fas fa-code text-primary"></i></button>
            <button uid="${item.id}" class="app-btn-resource btn btn-secondary" id="btn-resource-delete" href="javascript:;"><i class="fas fa-trash text-danger"></i></button>
        </div>
    </div> 
    `);
}

const showLoading = (message) => {
  $('body').waitMe({
    effect: 'rotateplane',
    bg: 'rgba(255,255,255,0.7)',
    color: '#000',
    maxSize: '',
    waitTime: -1,
    textPos: 'vertical',
    text: message
  });
}

const hideLoading = (message) => {
  $('body').waitMe('hide');
}

const msgBox = async (msg) => await ipcRenderer.invoke('alert', msg);
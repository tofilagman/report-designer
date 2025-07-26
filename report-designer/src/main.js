const { app, BrowserWindow, ipcMain, dialog } = require('electron/main');
const { clipboard } = require('electron');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const path = require('node:path');
require('dotenv').config();

const isDebug = () => {
    return process.argv.filter(x => x == '--debug').length > 0;
}

if (isDebug()) {
    require('electron-reloader')(module);
}

const createWindow = () => {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        //autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            sandbox: false,
            contextIsolation: false
        }
    })
    if (isDebug()) {
        win.webContents.openDevTools();
    }
    win.maximize();
    win.loadFile('src/index.html');
}

app.whenReady().then(() => {
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    });
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

ipcMain.handle('save-file', async (event, arg) => {
    return dialog.showSaveDialogSync({
        title: 'Save Pdf Report',
        properties: ['showOverwriteConfirmation'],
        filters: [{ name: 'Z Report', extensions: ['zrpt'] }],
    });
});

ipcMain.handle('open-file', async (event, arg) => {
    return dialog.showOpenDialogSync({
        title: 'Open Pdf Report',
        properties: ['openFile'],
        filters: [{ name: 'Z Report', extensions: ['zrpt'] }],
    });
});

ipcMain.handle('open-resource-file', async (event, arg) => {
    return dialog.showOpenDialogSync({
        title: 'Open Image Files',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Jpeg Files', extensions: ['jpg', 'jpeg'] }, { name: 'PNG Files', extensions: ['png'] }],
    });
});

ipcMain.handle('clipboard', async (event, arg) => {
    clipboard.writeText(arg);
});

ipcMain.handle('alert', async (event, arg) => {
    return dialog.showMessageBoxSync({ message: arg });
});

ipcMain.handle('upload', async (event, url, mpath, mfile) => {

    const instance = axios.create({
        baseURL: url
    });

    const formData = new FormData();
    formData.append('file', fs.createReadStream(mfile));

    try {
        await instance.post(mpath, formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            },
            contentType: false,
            processData: false,
            onUploadProgress: (progressEvent) => {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                console.log(`Upload Progress: ${percentCompleted}%`); 
            },
        });
    } catch (ex) {
        throw new Error(`${ex.response.status}: ${ex.response.data}`);
    }
});

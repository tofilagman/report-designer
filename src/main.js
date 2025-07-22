const { app, BrowserWindow, ipcMain, dialog } = require('electron/main');
const path = require('node:path');

try {
    require('electron-reloader')(module);
} catch { }

const createWindow = () => {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            worldSafeExecuteJavaScript: true,
            sandbox: false,
            contextIsolation: false, 
        }
    })
    // win.webContents.openDevTools(); 
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
        filters: { name: 'Z Report', extensions: ['zrpt'] },
    });
});

ipcMain.handle('open-file', async (event, arg) => {
    return dialog.showOpenDialogSync({
        title: 'Open Pdf Report',
        properties: ['openFile'],
        filters: { name: 'Z Report', extensions: ['zrpt'] },
    });
});
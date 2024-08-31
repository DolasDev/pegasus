// Modules to control application life and create native browser window
const {app, BrowserWindow, ipcMain} = require('electron')
const log = require('electron-log');
const path = require('path');
const devMode = (process.argv || []).indexOf('--dev') !== -1

if (devMode) {
  // load the app dependencies
  console.log('##dev mode##')
  const PATH_APP_NODE_MODULES = path.join(__dirname, '..');
  require('module').globalPaths.push(PATH_APP_NODE_MODULES);
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow

function createWindow () {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 700, 
    height: 610, 
    icon: path.join(__dirname, "/Icon/controller.ico"),
    nodeIntegration: true, // Enable Node.js integration for IPC
    contextIsolation: false // Disable context isolation for IPC in Electron 4
    })
  //mainWindow.setMenu(null);

  // and load the index.html of the app.
  mainWindow.loadFile(`src\\index.html`)

  // Open the DevTools.
  mainWindow.webContents.openDevTools()

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null
  })

  ipcMain.on('get-process-dir', (event) => {
    // Send the __dirname to the renderer
    event.sender.send('process-dir', __dirname);
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

app.on('console-message', function (event, level, message, line) {
  console.log('error error here');
  log.info(`${event}|${level}|${message}|${line}`)
})

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: '智能股票管家',
    icon: path.join(__dirname, 'assets/icon.png')
  });

  // 加载前端页面
  // 开发环境使用 localhost，生产环境使用打包后的文件
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:3002');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile('frontend/dist/index.html');
  }

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function startBackend() {
  // 启动后端服务
  const backendPath = path.join(__dirname, 'backend/src/index.js');
  backendProcess = spawn('node', [backendPath], {
    stdio: 'pipe'
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`Backend: ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`Backend Error: ${data}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
  });
}

app.whenReady().then(() => {
  startBackend();
  
  // 等待后端启动完成
  setTimeout(() => {
    createWindow();
  }, 2000);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  // 关闭后端服务
  if (backendProcess) {
    backendProcess.kill();
  }
  
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // 确保后端服务被关闭
  if (backendProcess) {
    backendProcess.kill();
  }
});

import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, nativeImage } from 'electron';

const APP_DISPLAY_NAME = 'Teams Policy Config';

function applyMacDockIconSafely(): void {
	const dockIconPath = resolveMacDockIconPath();
	if (!dockIconPath) {
		return;
	}

	try {
		const dockImage = nativeImage.createFromPath(dockIconPath);
		if (dockImage.isEmpty()) {
			console.warn(`Dock icon could not be loaded from path: ${dockIconPath}`);
			return;
		}
		app.dock?.setIcon(dockImage);
	} catch (error) {
		console.warn('Failed to set macOS Dock icon:', error);
	}
}

function resolveMacDockIconPath(): string | undefined {
	const candidates = [
		path.join(app.getAppPath(), 'build', 'icon.png'),
		path.join(process.cwd(), 'build', 'icon.png'),
		path.join(__dirname, '..', 'build', 'icon.png'),
		path.join(app.getAppPath(), 'myicon.iconset', 'icon_512x512@2x.png'),
		path.join(process.cwd(), 'myicon.iconset', 'icon_512x512@2x.png'),
		path.join(__dirname, '..', 'myicon.iconset', 'icon_512x512@2x.png')
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	return undefined;
}

/**
 * Resolves the application icon path for the BrowserWindow. It checks multiple common locations where the icon might be placed, including the app's build directory and the current working directory. This is necessary because the location of resources can vary between development and production builds, and between different packaging configurations.
 * @returns The file path to the application icon if found, or undefined if no icon file is found in the expected locations. The function looks for 'icon.ico' on Windows, 'icon.icns' on macOS, and 'icon.png' on Linux, checking both the build directory and the current working directory for each format.
 * Note: The icon file should be named according to the platform conventions (icon.ico for Windows, icon.icns for macOS, and icon.png for Linux) and placed in either the build directory or the root of the project for it to be detected by this function.
 */
function resolveAppIconPath(): string | undefined {
	const extension = process.platform === 'win32' ? 'ico' : process.platform === 'darwin' ? 'icns' : 'png';
	const iconFileName = `icon.${extension}`;
	const candidates = [
		path.join(app.getAppPath(), 'build', iconFileName),
		path.join(process.cwd(), 'build', iconFileName),
		path.join(__dirname, '..', 'build', iconFileName)
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	return undefined;
}

export function createWindow(): void {
	const iconPath = resolveAppIconPath();

	if (process.platform === 'darwin') {
		applyMacDockIconSafely();
	}

	const win = new BrowserWindow({
		width: 900,
		height: 700,
		...(iconPath ? { icon: iconPath } : {}),
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			nodeIntegration: false,
			contextIsolation: true
		},
	});
	win.maximize();
	win.setTitle(APP_DISPLAY_NAME);

	const devServerUrl = process.env.VITE_DEV_SERVER_URL;
	if (devServerUrl) {
		win.loadURL(devServerUrl).catch((err) => {
			console.error('Failed to load Vite dev server URL:', devServerUrl, err);
			win.loadFile(path.join(__dirname, '../dist/index.html'));
		});
	} else {
		// If in dev mode but VITE_DEV_SERVER_URL is missing, show a clear error
		if (process.env.NODE_ENV === 'development') {
			win.loadFile(path.join(__dirname, '../dist/index.html'));
			win.webContents.once('did-finish-load', () => {
				win.webContents.executeJavaScript(`
					document.body.innerHTML = '<div style="color:red;font-size:1.5em;padding:2em;">VITE_DEV_SERVER_URL is not set.\n\nPlease run using <code>npm run dev</code> for development, or <code>npm run build &amp;&amp; npm start</code> for production.</div>';
				`);
			});
		} else {
			win.loadFile(path.join(__dirname, '../dist/index.html'));
		}
	}

	// Enable context menu (right-click)
	win.webContents.on('context-menu', (_event, params) => {
		win.webContents.executeJavaScript(`window.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX:${params.x}, clientY:${params.y}}));`);
	});

	// Add DevTools shortcut (Ctrl+Shift+I or Cmd+Opt+I)
	win.webContents.on('before-input-event', (event, input) => {
		const isDevTools =
			(input.control && input.shift && input.key.toLowerCase() === 'i') ||
			(input.meta && input.alt && input.key.toLowerCase() === 'i');
		if (isDevTools) {
			win.webContents.openDevTools({ mode: 'detach' });
			event.preventDefault();
		}
	});
}

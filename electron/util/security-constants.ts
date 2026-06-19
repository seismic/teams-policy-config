/**
 * Security constants for the BrowserWindow renderer.
 *
 * Exported as plain values so the test suite can assert on the exact settings
 * used at runtime. If any value changes, the test fails — the constants cannot
 * silently drift from what the security team required.
 *
 * Assumption being enforced: the renderer loads ONLY local content.
 * See createWindow() in window.ts for how these are wired into BrowserWindow.
 */

/**
 * webPreferences fields that enforce the renderer sandbox.
 * Spread into BrowserWindow({ webPreferences: { preload, ...SECURE_WEB_PREFERENCES } }).
 */
export const SECURE_WEB_PREFERENCES = {
	nodeIntegration: false,   // No Node.js APIs in the renderer
	contextIsolation: true,   // Renderer JS context isolated from the preload context
	sandbox: true,            // OS-level sandbox; Node built-ins unreachable even if bridge is bypassed
} as const;

/**
 * CSP applied to dev server (HTTP) responses via session.webRequest.onHeadersReceived.
 * Vite HMR requires 'unsafe-inline' scripts and localhost WebSocket access.
 */
export const DEV_CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"font-src 'self' data:",
	"connect-src 'self' ws://localhost:* http://localhost:*",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'none'",
].join('; ');

/**
 * Strict CSP for production file:// loads.
 * This value MUST match the content= attribute of the <meta http-equiv="Content-Security-Policy">
 * tag in index.html. The security-controls test suite asserts that they are identical.
 */
export const PROD_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

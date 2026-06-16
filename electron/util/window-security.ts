/**
 * Security helpers for the BrowserWindow, extracted as pure (Electron-free)
 * functions so the security-controls test suite can assert on them directly.
 *
 * createWindow() in window.ts wires these in; keeping the decision logic here
 * means the runtime control and the test enforce the same rule — the same
 * pattern already used by ./url (isLocalUrl) and ./security-constants.
 *
 * Assumption being enforced: the renderer loads ONLY local content.
 */
import { SECURE_WEB_PREFERENCES } from './security-constants';

/**
 * Builds the webPreferences object passed to `new BrowserWindow({ webPreferences })`:
 * the hardened sandbox flags (sandbox / contextIsolation / nodeIntegration) plus
 * the preload bridge path.
 *
 * Returns a fresh object each call so callers cannot mutate the shared
 * SECURE_WEB_PREFERENCES constant, and so a test can prove the hardened flags
 * are actually applied to the window — not just defined in isolation.
 */
export function buildSecureWebPreferences(preloadPath: string) {
	return {
		preload: preloadPath,
		...SECURE_WEB_PREFERENCES,
	};
}

export interface NewWindowDecision {
	/** Always 'deny' — the app never opens an in-process child window. */
	action: 'deny';
	/** An https:// URL to hand to the system browser, or null to open nothing. */
	openExternal: string | null;
}

/**
 * Decides what to do when the renderer requests a new window (window.open(),
 * a target="_blank" link, etc.) — the logic behind setWindowOpenHandler.
 *
 * Policy: deny every in-process window. Only https:// URLs are forwarded to the
 * system browser; everything else (http, file, data, javascript, malformed) is
 * denied and opens nothing.
 */
export function resolveNewWindowAction(url: string): NewWindowDecision {
	try {
		const { protocol } = new URL(url);
		if (protocol === 'https:') {
			return { action: 'deny', openExternal: url };
		}
	} catch {
		// Malformed URL — fall through to a plain deny.
	}
	return { action: 'deny', openExternal: null };
}

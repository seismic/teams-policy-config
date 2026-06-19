/**
 * Security utility — URL origin classification for the navigation guard.
 *
 * The renderer is assumed to load only local content (file:// in production,
 * http://localhost in development). This module provides the single source of
 * truth for what "local" means so that both the runtime guard (will-navigate
 * handler) and the test suite enforce the same rule.
 *
 * Allowed origins:
 *   - file://   — production builds served from the bundled dist/
 *   - localhost  — Vite dev server (http or https)
 *
 * Everything else is external and must be blocked by the navigation guard.
 */

export function isLocalUrl(url: string): boolean {
	try {
		const { protocol, hostname } = new URL(url);
		return protocol === 'file:' ||
			((protocol === 'http:' || protocol === 'https:') && hostname === 'localhost');
	} catch {
		return false;
	}
}

import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = import.meta.dirname;

/**
 * Build-time guard: every inline <script> in the built HTML must have its sha256 listed in the
 * Content-Security-Policy in vercel.json, otherwise the browser would silently block it in production.
 */
function cspInlineScriptGuard() {
  return {
    name: 'mk-csp-inline-script-guard',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
      const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value || '';
      for (const file of Object.values(bundle)) {
        if (!file.fileName.endsWith('.html')) continue;
        const html = String(file.source);
        for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
          if (!m[1].trim()) continue;
          const hash = `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`;
          if (!csp.includes(hash)) this.error(`Inline script in ${file.fileName} is not allowed by the CSP in vercel.json. Add ${hash} to script-src.`);
        }
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, root, ''), ...process.env };
  // Production on Vercel must talk to the real Apps Script backend, never ship in preview (localStorage) mode.
  if (env.VERCEL_ENV === 'production' && !String(env.VITE_API_URL || '').trim()) {
    throw new Error('VITE_API_URL is empty for a production build. Set it in Vercel → Settings → Environment Variables (Production), then redeploy.');
  }
  return {
    plugins: [cspInlineScriptGuard()],
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        input: { main: resolve(root, 'index.html'), staff: resolve(root, 'staff.html') },
        output: { manualChunks: { three: ['three'], physics: ['cannon-es'] } }
      }
    },
    server: { host: true }
  };
});

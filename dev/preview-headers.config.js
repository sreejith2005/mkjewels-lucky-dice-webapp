// `npm run preview:vercel` — serves dist/ like `vite preview`, but with the headers from vercel.json
// (CSP, Permissions-Policy, caching), so production header problems show up locally.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import base from '../vite.config.js';

function vercelHeaders() {
  const rules = JSON.parse(readFileSync(resolve(import.meta.dirname, '../vercel.json'), 'utf8')).headers
    .map((r) => ({ re: new RegExp('^' + r.source.replace(/\(\.\*\)/g, '(.*)') + '$'), headers: r.headers }));
  return {
    name: 'mk-vercel-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '/').split('?')[0];
        rules.forEach((r) => { if (r.re.test(path)) r.headers.forEach((h) => res.setHeader(h.key, h.value)); });
        next();
      });
    }
  };
}

export default (env) => {
  const cfg = base(env);
  return { ...cfg, plugins: [...(cfg.plugins || []), vercelHeaders()] };
};

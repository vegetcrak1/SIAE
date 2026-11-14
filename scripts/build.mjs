// Compila la interfaz (web/) a la carpeta dist/ con nombres con huella para caché eficiente. Uso: npm run build
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/assets', { recursive: true });

const result = await build({
  entryPoints: { app: 'web/src/main.tsx', styles: 'web/styles.css' },
  entryNames: '[name]-[hash]',
  outdir: 'dist/assets',
  bundle: true,
  splitting: true,          // jsQR (lector alternativo de QR) se descarga solo si el navegador no trae BarcodeDetector
  format: 'esm',
  target: ['es2022', 'chrome100', 'safari15'],
  minify: !watch,
  sourcemap: false,
  metafile: true,
  jsx: 'automatic',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  logLevel: 'info',
});

const outputs = Object.keys(result.metafile.outputs).map((p) => p.replace(/^dist\//, ''));
const entry = (name, ext) => outputs.find((o) => new RegExp(`^assets/${name}-[A-Z0-9]{8}\\.${ext}$`).test(o));
const js = entry('app', 'js');
const css = entry('styles', 'css');
if (!js || !css) throw new Error('No se encontraron los archivos compilados.');

writeFileSync('dist/index.html', readFileSync('web/index.html', 'utf8').replace('/app.css', `/${css}`).replace('/app.js', `/${js}`));
for (const f of ['manifest.webmanifest', 'icon.svg']) copyFileSync(`web/${f}`, `dist/${f}`);
console.log(`Listo: dist/ (${readdirSync('dist/assets').length} archivos)`);

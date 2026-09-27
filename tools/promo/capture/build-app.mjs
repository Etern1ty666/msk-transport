// Сборка фронта TramFlow для ролика: относительные пути + слой виртуального времени перед бандлом.
import { execSync } from 'child_process'
import fs from 'fs'
import { fileURLToPath } from 'url'
const p = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const out = p('../public/app/')
execSync(`npx vite build --base ./ --outDir "${out}" --emptyOutDir`, { cwd: p('../../../frontend/'), stdio: 'inherit' })
fs.copyFileSync(p('../app-shim/vt.js'), out + 'vt.js')
const html = fs.readFileSync(out + 'index.html', 'utf8').replace('<head>', '<head>\n    <script src="./vt.js"></script>')
fs.writeFileSync(out + 'index.html', html)
console.log('app ready:', out)

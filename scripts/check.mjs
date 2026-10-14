import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = ['index.html', 'random-walk.html', '鸟群涌现.html'];

function checkLink(file, link) {
  if (!link || link.startsWith('#') || /^(https?:|mailto:|data:)/i.test(link)) return;
  assert(!/^(file:|[a-z]:[\\/])/i.test(link), `${file}: 本地绝对路径不可移植`);
  const pathname = decodeURIComponent(link.split(/[?#]/)[0]);
  const target = resolve(root, dirname(file), pathname);
  const inside = relative(root, target);
  assert(inside !== '..' && !inside.startsWith('../') && !inside.startsWith('..\\') && !isAbsolute(inside), `${file}: 链接超出仓库`);
  assert(existsSync(target) && statSync(target).isFile(), `${file}: 无效链接 ${link}`);
}

for (const file of pages) {
  const html = readFileSync(resolve(root, file), 'utf8');
  assert(/<!doctype html>/i.test(html), `${file}: 缺少 HTML doctype`);
  assert(/<html\b[^>]*lang="zh-CN"/i.test(html), `${file}: 缺少页面语言`);
  assert(/<meta\b[^>]*charset="utf-8"/i.test(html), `${file}: 缺少 UTF-8 编码声明`);
  assert(/<meta\b[^>]*name="viewport"/i.test(html), `${file}: 缺少移动端 viewport`);
  assert(/<title>[^<]+<\/title>/i.test(html), `${file}: 缺少页面标题`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${file}: 重复元素 id`);
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1], { filename: file });
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/gi)) checkLink(file, match[1]);
  if (file !== 'index.html') {
    assert(!/<(?:script|link|img)\b[^>]*(?:src|href)="https?:\/\//i.test(html), `${file}: 动画包含外部运行资源，需更新离线说明`);
  }
  console.log(`PASS 页面结构、脚本语法与链接：${file}`);
}

for (const file of ['README.md', 'CONTRIBUTING.md']) {
  const markdown = readFileSync(resolve(root, file), 'utf8');
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) checkLink(file, match[1]);
  console.log(`PASS 文档链接：${file}`);
}

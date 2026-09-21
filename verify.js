// 用 CDP 驱动 Edge 无头浏览器，验证页面核心功能
const { spawn } = require('child_process');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main() {
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=9223', '--user-data-dir=C:\\temp\\edge-test-profile',
    'about:blank',
  ], { stdio: 'ignore' });

  // 等待调试端口就绪
  let targets = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch('http://127.0.0.1:9223/json');
      targets = await res.json();
      if (targets.length) break;
    } catch (e) {}
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise(res => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };

  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:7100/' });
  await new Promise(r => setTimeout(r, 2500));

  const checks = [];
  const check = (name, cond) => { checks.push([name, !!cond]); console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name); };

  check('VOCAB 载入 3086 词', await evalJs('VOCAB.length') === 3086);
  check('词表首屏渲染 100 行', await evalJs(`document.querySelectorAll('#word-list .word-row').length`) === 100);
  check('统计：总数 3086', await evalJs(`document.querySelector('#stat-total').textContent`) === '3086');
  check('筛选结果 3086', await evalJs(`document.querySelector('#meta-info').textContent.includes('3086')`));

  // 级别筛选 A
  await evalJs(`document.querySelector('#lv-chips .chip[data-lv="A"]').click()`);
  await new Promise(r => setTimeout(r, 300));
  check('A 级筛选 = 570', await evalJs(`document.querySelector('#meta-info').textContent.includes('570')`));

  // 搜索
  await evalJs(`const q=document.querySelector('#q'); q.value='abandon'; q.dispatchEvent(new Event('input'))`);
  await new Promise(r => setTimeout(r, 300));
  check('搜索 abandon 命中 1 条', await evalJs(`document.querySelector('#meta-info').textContent.includes(' 1 个')`));

  // 加入词库
  await evalJs(`document.querySelector('#word-list .add-btn').click()`);
  await new Promise(r => setTimeout(r, 300));
  check('词库计数 = 1', await evalJs(`document.querySelector('#stat-bank').textContent`) === '1');
  check('localStorage 已持久化', await evalJs(`JSON.parse(localStorage.getItem('nju-vocab-bank-v1')).length`) === 1);

  // 批量模式
  await evalJs(`const q2=document.querySelector('#q'); q2.value=''; q2.dispatchEvent(new Event('input'))`);
  await evalJs(`toggleBatch(true)`);
  await new Promise(r => setTimeout(r, 300));
  check('批量模式出现复选框', await evalJs(`document.querySelectorAll('#word-list .ck').length`) > 0);
  await evalJs(`document.querySelectorAll('#word-list .ck').forEach(c=>{c.checked=true;c.onchange(true)})`);
  await evalJs(`batchAdd()`);
  await new Promise(r => setTimeout(r, 300));
  check('批量加入后词库 = 100（含已入库的 abandon，自动去重）', await evalJs(`bank.size`) === 100);

  // 词库页
  await evalJs(`switchTab('bank')`);
  await new Promise(r => setTimeout(r, 300));
  check('词库页渲染 100 行', await evalJs(`document.querySelectorAll('#bank-list .word-row').length`) === 100);
  await evalJs(`removeWord('abandon')`);
  await new Promise(r => setTimeout(r, 300));
  check('移除后词库 = 99', await evalJs(`bank.size`) === 99);

  // 隐藏已入词库
  await evalJs(`switchTab('read')`);
  await evalJs(`toggleBatch(false)`);
  await evalJs(`document.querySelector('#lv-chips .chip[data-lv="all"]').click()`);
  await evalJs(`const h=document.querySelector('#tgl-hide-banked'); h.checked=true; h.dispatchEvent(new Event('change'))`);
  await new Promise(r => setTimeout(r, 300));
  check('隐藏已入库后剩余数正确（含跨级别重复词一并隐藏）', await evalJs(`currentList.length`) === await evalJs(`VOCAB.filter(x=>!bank.has(x.w)).length`));

  // 遮罩模式
  await evalJs(`const m=document.querySelector('#tgl-mask'); m.checked=true; m.dispatchEvent(new Event('change'))`);
  await new Promise(r => setTimeout(r, 300));
  check('遮罩模式释义被模糊', await evalJs(`document.querySelectorAll('#word-list .m.masked').length`) > 0);

  // 分页
  await evalJs(`const m2=document.querySelector('#tgl-mask'); m2.checked=false; m2.dispatchEvent(new Event('change'))`);
  await evalJs(`goPage(2)`);
  await new Promise(r => setTimeout(r, 300));
  check('第 2 页渲染', await evalJs(`document.querySelectorAll('#word-list .word-row').length`) === 100);

  // 截图
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('verify_page2.png', Buffer.from(shot.result.data, 'base64'));
  await evalJs(`goPage(1)`);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('verify_page1.png', Buffer.from(shot2.resultData || shot2.result.data, 'base64'));

  const failed = checks.filter(c => !c[1]);
  console.log(failed.length ? `共 ${failed.length} 项失败` : '全部通过');
  ws.close();
  edge.kill();
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error('ERROR', e); process.exit(1); });

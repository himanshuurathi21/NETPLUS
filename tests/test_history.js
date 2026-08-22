let pass = 0, fail = 0;
const fs = require('fs');
const BASE = 'http://127.0.0.1:3000';
function check(name, cond, extra) {
  (cond ? pass++ : fail++);
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra !== undefined ? ' | ' + extra : ''));
}
(async () => {
  try {
    if (typeof fetch !== 'function') throw new Error('fetch not available (Node 18+ required)');
    await fetch(BASE + '/api/health');
  } catch (e) {
    console.log('ALL HISTORY TESTS SKIPPED: ' + e.message);
    console.log('  (start the server with `node server.js` first)');
    console.log('RESULT: pass=0 fail=0 (skipped)');
    return;
  }
  const created = [];
  try {
    const before = await (await fetch(BASE + '/api/history')).json();
    check('history list endpoint', before.ok && Array.isArray(before.list));
    const beforeCount = (before.list || []).length;

    const scanRes = await fetch(BASE + '/api/scan');
    const scan = await scanRes.json();
    check('scan runs for history test', scan.ok && scan.data && scan.data.connectivity, scan.ok ? 'mode=' + (scan.data.mode || 'n/a') : 'scan failed');
    if (scan.ok) created.push(scan.data.id);

    const after = await (await fetch(BASE + '/api/history')).json();
    check('scan saved to history', after.ok && after.list.length === beforeCount + 1, 'count=' + after.list.length);

    const id = after.list[0].id;
    const item = await (await fetch(BASE + '/api/history/' + encodeURIComponent(id))).json();
    check('history item GET', item.ok && item.data && item.data.connectivity, 'id=' + id);

    const miss = await fetch(BASE + '/api/history/__missing__');
    check('history item 404', miss.status === 404);

    const act = await (await fetch(BASE + '/api/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'flush-dns' })
    })).json();
    check('action flush-dns', act.ok && Array.isArray(act.outputs), act.ok ? act.outputs[0].cmd : act.error);

    const bad = await fetch(BASE + '/api/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'nope' })
    });
    check('action unknown 400', bad.status === 400);

    const delRes = await fetch(BASE + '/api/history/' + encodeURIComponent(id), { method: 'DELETE' });
    const del = await delRes.json();
    check('history item DELETE', delRes.status === 200 && del.ok, 'id=' + id);
    const final = await (await fetch(BASE + '/api/history')).json();
    check('history back to original', final.list.length === beforeCount, 'count=' + final.list.length);
  } catch (e) {
    console.log('ERROR: ' + e.message);
    for (const id of created) { try { await fetch(BASE + '/api/history/' + encodeURIComponent(id), { method: 'DELETE' }); } catch (x) {} }
  } finally {
    console.log('RESULT: pass=' + pass + ' fail=' + fail);
    process.exitCode = fail ? 1 : 0;
  }
})();

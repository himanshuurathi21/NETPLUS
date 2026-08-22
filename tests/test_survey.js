const fs = require('fs');
const base = 'http://localhost:3000';
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  ok ? pass++ : fail++;
};

(async () => {
  const health = await fetch(base + '/api/health').then(r => r.json());
  check('health', health.ok === true);

  const net = await fetch(base + '/api/network').then(r => r.json());
  check('network scan', net.ok === true, 'duration=' + net.data.scanDurationMs + 'ms, mode=' + net.data.mode);

  const dl = await fetch(base + '/api/speedtest/data?bytes=1048576');
  const dlBuf = Buffer.from(await dl.arrayBuffer());
  check('speedtest data', dl.ok && dlBuf.length === 1048576, dlBuf.length + ' bytes');

  const payload = Buffer.alloc(2097152, 7);
  const up = await fetch(base + '/api/speedtest/upload', { method: 'POST', body: payload }).then(r => r.json());
  check('speedtest upload', up.ok && up.bytes === 2097152, up.mbps + ' Mbps');

  const survey = {
    locationName: 'Test - Lobby', ssid: 'HomeNet', bssid: 'AA:BB:CC:DD:EE:FF', band: '2.4 GHz', channel: '6',
    rssiDbm: -55, signalPct: 70, quality: 'Good', linkTx: 130, linkRx: 65, standard: '802.11n',
    security: 'WPA2-Personal', download: 120.5, upload: 40.2, ping: 12, jitter: 3.5, packetLoss: 0,
    lat: 28.6139, lng: 77.209, networkType: 'WiFi', lanStatus: 'Disconnected', distanceM: 4.0,
    notes: 'unit test', timestamp: new Date().toISOString()
  };
  const created = await fetch(base + '/api/surveys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(survey) }).then(r => r.json());
  check('survey create', created.ok === true && created.survey.id, created.survey && created.survey.id);
  const id = created.survey && created.survey.id;

  const list = await fetch(base + '/api/surveys').then(r => r.json());
  check('survey list', list.ok && list.surveys.some(s => s.id === id), list.surveys.length + ' points');

  const upd = await fetch(base + '/api/surveys/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationName: 'Test - Lobby (renamed)' }) }).then(r => r.json());
  check('survey update', upd.ok && upd.survey.locationName === 'Test - Lobby (renamed)');

  const exported = {};
  for (const fmt of ['csv', 'xlsx', 'json', 'kml']) {
    const ex = await fetch(base + '/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: fmt, folder: 'UnitTest', ids: [id] }) }).then(r => r.json());
    check('export ' + fmt, ex.ok && ex.files.length === 1, ex.files && ex.files[0]);
    exported[fmt] = ex.files && ex.files[0];
  }

  const csvPath = exported.csv;
  const csv = fs.readFileSync(csvPath, 'utf8');
  check('csv content', csv.indexOf('Location') !== -1 && csv.indexOf('Test - Lobby (renamed)') !== -1);
  check('csv filename has time', /Survey_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/.test(csvPath), csvPath);

  const xlsxBuf = fs.readFileSync(exported.xlsx);
  check('xlsx zip magic', xlsxBuf[0] === 0x50 && xlsxBuf[1] === 0x4b && xlsxBuf[2] === 0x03 && xlsxBuf[3] === 0x04, 'PK..');

  const json = JSON.parse(fs.readFileSync(exported.json, 'utf8'));
  check('json content', json.count === 1 && json.surveys[0].locationName === 'Test - Lobby (renamed)');

  const kml = fs.readFileSync(exported.kml, 'utf8');
  check('kml content', kml.indexOf('<kml') !== -1 && kml.indexOf('<Placemark>') !== -1, 'Placemarks=' + (kml.match(/<Placemark>/g) || []).length);

  const del = await fetch(base + '/api/surveys/' + id, { method: 'DELETE' }).then(r => r.json());
  check('survey delete', del.ok === true);

  const act = await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'flush-dns' }) }).then(r => r.json());
  check('action flush-dns', act.ok === true && Array.isArray(act.outputs), act.label || '');
  const actBad = await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'nope' }) }).then(r => r.json());
  check('action unknown guard', actBad.ok === false);

  const emptyEx = await fetch(base + '/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'csv', ids: ['no-such-survey-id-xyz'] }) }).then(r => r.json());
  check('export empty guard', emptyEx.ok === false);

  console.log('RESULT: pass=' + pass + ' fail=' + fail);
  process.exitCode = fail ? 1 : 0;
  try { const dir = require('path').dirname(exported.csv); fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
})().catch(e => { console.log('FAIL main: ' + e.message); process.exitCode = 1; });

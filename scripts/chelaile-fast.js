#!/usr/bin/env node
'use strict';

const https = require('https');
const crypto = require('crypto');

const DEFAULTS = {
  host: 'https://web.chelaile.net.cn',
  src: 'wechat_shaoguan',
  version: '9.1.2',
  vc: '1',
  sign: '1',
  gpstype: 'wgs',
  citylistVersion: '3.80.0'
};

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function randomBrowserId() {
  return `browser_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildContext(args) {
  const userId = args['user-id'] || randomBrowserId();
  const src = args.src || DEFAULTS.src;
  return {
    host: DEFAULTS.host,
    src,
    version: args.v || DEFAULTS.version,
    vc: DEFAULTS.vc,
    sign: DEFAULTS.sign,
    gpstype: args.gpstype || DEFAULTS.gpstype,
    cityId: args['city-id'] || null,
    cityName: null,
    lat: args.lat || null,
    lng: args.lng || null,
    userId,
    h5Id: args['h5-id'] || userId,
    referer: `${DEFAULTS.host}/customer_ch5/?1=1&randomTime=${Date.now()}&src=${encodeURIComponent(src)}`
  };
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function md5Hex(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function decryptAes(base64) {
  const key = Buffer.from('422556651C7F7B2B5C266EED06068230', 'utf8');
  const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(base64, 'base64'), decipher.final()]).toString('utf8');
}

function stripMarkers(raw) {
  return raw.trim().replace(/^\*\*YGKJ/, '').replace(/YGKJ##$/, '');
}

function buildQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    qs.set(key, String(value));
  });
  return qs.toString();
}

function defaultHeaders(ctx, accept) {
  return {
    referer: ctx.referer,
    'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36',
    accept: accept || '*/*'
  };
}

function request(url, headers) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          resolve(data);
        });
      })
      .on('error', reject);
  });
}

function sharedParams(ctx) {
  const params = {
    cityId: ctx.cityId,
    s: 'h5',
    v: ctx.version,
    vc: ctx.vc,
    src: ctx.src,
    userId: ctx.userId,
    h5Id: ctx.h5Id,
    sign: ctx.sign
  };
  if (ctx.lat && ctx.lng) {
    params.lat = ctx.lat;
    params.lng = ctx.lng;
    params.geo_lat = ctx.lat;
    params.geo_lng = ctx.lng;
    params.gpstype = ctx.gpstype;
  }
  return params;
}

async function action(ctx, handler, params, accept) {
  const query = buildQuery({ ...params, ...sharedParams(ctx) });
  const url = `${ctx.host}/api/${handler}?${query}`;
  const raw = await request(url, defaultHeaders(ctx, accept));
  const json = JSON.parse(stripMarkers(raw));
  const status = json.jsonr && json.jsonr.status;
  if (status !== '00') {
    throw new Error(json.jsonr && (json.jsonr.errmsg || json.jsonr.status) || 'Unknown API error');
  }
  return json.jsonr.data;
}

async function encryptedAction(ctx, handler, bizParams) {
  const rawSign = Object.entries(bizParams).map(([key, value]) => `${key}=${value}`).join('&');
  const cryptoSign = md5Hex(rawSign + 'qwihrnbtmj');
  const data = await action(ctx, handler, { ...bizParams, cryptoSign });
  if (!data || !data.encryptResult) {
    throw new Error(`Missing encryptResult from ${handler}`);
  }
  return JSON.parse(decryptAes(data.encryptResult));
}

async function resolveCity(ctx) {
  if (ctx.cityId) {
    return ctx;
  }
  ensure(ctx.lat && ctx.lng, 'Missing --city-id or --lat/--lng');
  const query = buildQuery({
    type: 'gpsRealtimeCity',
    lat: ctx.lat,
    lng: ctx.lng,
    gpstype: ctx.gpstype,
    s: 'android',
    v: DEFAULTS.citylistVersion,
    src: 'webapp_default',
    userId: ''
  });
  const raw = await request(`${ctx.host}/cdatasource/citylist?${query}`, defaultHeaders(ctx));
  const json = JSON.parse(raw);
  if (json.status !== 'OK' || !json.data || !json.data.gpsRealtimeCity) {
    throw new Error('Failed to resolve cityId from coordinates');
  }
  ctx.cityId = json.data.gpsRealtimeCity.cityId;
  ctx.cityName = json.data.gpsRealtimeCity.cityName;
  return ctx;
}

function dedupeBy(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!map.has(key)) {
      map.set(key, item);
    }
  });
  return [...map.values()];
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function normalizeLine(value) {
  return normalizeText(value).replace(/路/g, '');
}

function lineMatches(query, line) {
  if (!query) {
    return true;
  }
  const target = normalizeLine(query);
  const candidates = [
    line.lineNo,
    line.name,
    line.lineName
  ]
    .filter(Boolean)
    .map(normalizeLine);
  return candidates.includes(target);
}

function stationMatches(query, station) {
  if (!query) {
    return true;
  }
  const target = normalizeText(query);
  const name = normalizeText(station.sn);
  return name === target || name.includes(target) || target.includes(name);
}

function directionLabel(line) {
  const start = line.startSn || line.startStopName || '-';
  const end = line.endSn || line.endStopName || '-';
  return `${start} -> ${end}`;
}

function minuteText(state) {
  if (!state) {
    return '-';
  }
  if (typeof state.value === 'number' && state.value >= 0) {
    return `${state.value}m`;
  }
  if (typeof state.travelTime === 'number' && state.travelTime > 0) {
    return `${Math.ceil(state.travelTime / 60)}m`;
  }
  return '-';
}

async function searchKeyword(ctx, keyword, count) {
  return action(
    ctx,
    'basesearch/client/clientSearch.action',
    { key: keyword, count: count || 5 },
    'text/plain,*/*'
  );
}

async function searchList(ctx, keyword, type) {
  return action(
    ctx,
    'basesearch/client/clientSearchList.action',
    { key: keyword, type },
    'text/plain,*/*'
  );
}

async function getNearbyStations(ctx) {
  const data = await action(ctx, 'bus/stop!nearPhysicalStns.action', {
    cityState: '2',
    gpstype: ctx.gpstype
  });
  return dedupeBy(data.nearStations || [], (item) => item.sId);
}

async function getNearbyLines(ctx) {
  const data = await encryptedAction(ctx, 'bus/stop!encryptedNearlines.action', {
    cityState: '2'
  });
  return data.nearLines || [];
}

async function getStationDetail(ctx, stationId) {
  return encryptedAction(ctx, 'bus/stop!encryptedStnDetail.action', {
    stationId,
    destSId: '-1'
  });
}

async function getLineDetail(ctx, detail) {
  return encryptedAction(ctx, 'bus/line!encryptedLineDetail.action', {
    lineId: detail.lineId,
    lineName: detail.lineName,
    direction: detail.direction,
    stationName: detail.stationName,
    nextStationName: detail.nextStationName,
    lineNo: detail.lineNo,
    targetOrder: detail.targetOrder
  });
}

async function getCityLineList(ctx) {
  const data = await action(ctx, 'bus/cityLineList', {});
  const groups = data.allLines || {};
  const lines = [];
  Object.values(groups).forEach((items) => {
    (items || []).forEach((item) => lines.push(item));
  });
  return dedupeBy(lines, (item) => item.lineId);
}

async function getLineRoute(ctx, lineId) {
  return action(ctx, 'bus/line!lineRoute.action', { lineId });
}

async function resolveStation(ctx, args) {
  if (args['station-id']) {
    return {
      sId: args['station-id'],
      sn: args.station || args['station-id'],
      lat: ctx.lat,
      lng: ctx.lng,
      gpstype: ctx.gpstype,
      source: 'direct'
    };
  }

  let nearby = [];
  if (ctx.lat && ctx.lng) {
    nearby = await getNearbyStations(ctx);
    if (!args.station && nearby.length) {
      return { ...nearby[0], gpstype: ctx.gpstype, source: 'nearby' };
    }
    const nearbyMatch = nearby.find((item) => stationMatches(args.station, item));
    if (nearbyMatch) {
      return { ...nearbyMatch, gpstype: ctx.gpstype, source: 'nearby' };
    }
  }

  ensure(args.station, 'Missing --station or --station-id');
  const search = await searchKeyword(ctx, args.station, 5);
  const stations = search.stations || [];
  ensure(stations.length > 0, `No station found for ${args.station}`);

  const exact = stations.find((item) => normalizeText(item.sn) === normalizeText(args.station));
  const picked = exact || stations[0];
  return {
    ...picked,
    gpstype: search.gpstype || 'gcj',
    source: 'search'
  };
}

function stationLineSummary(entry) {
  const eta = entry.stnStates && entry.stnStates.length ? minuteText(entry.stnStates[0]) : '-';
  return {
    lineNo: entry.line.lineNo || entry.line.name,
    lineId: entry.line.lineId,
    direction: entry.line.direction,
    directionLabel: directionLabel(entry.line),
    targetOrder: entry.targetStation && (entry.targetStation.targetOrder || entry.targetStation.order),
    nextStationName: entry.nextStation && entry.nextStation.sn,
    eta,
    state: entry.line.state,
    desc: entry.line.desc || entry.line.shortDesc || ''
  };
}

function formatBus(bus, targetOrder) {
  const order = bus.specialOrder || bus.order;
  const distance = typeof bus.distanceToSc === 'number' && bus.distanceToSc >= 0 ? `${bus.distanceToSc}m` : '-';
  const travel = typeof bus.travelTime === 'number' && bus.travelTime > 0 ? `${Math.ceil(bus.travelTime / 60)}m` : '-';
  const diff = typeof order === 'number' ? Math.abs(order - targetOrder) : 9999;
  return {
    order,
    diff,
    busId: bus.busId || '-',
    distance,
    travel,
    state: bus.state,
    timeStr: bus.timeStr || '-'
  };
}

function printUsage() {
  const lines = [
    'Usage:',
    '  node scripts/chelaile-fast.js nearby --lat <lat> --lng <lng> [--gpstype wgs|gcj]',
    '  node scripts/chelaile-fast.js station --city-id <id>|--lat <lat> --lng <lng> [--station <name>] [--line <lineNo>]',
    '  node scripts/chelaile-fast.js realtime --city-id <id>|--lat <lat> --lng <lng> --station <name>|--station-id <id> --line <lineNo>',
    '  node scripts/chelaile-fast.js route --city-id <id>|--lat <lat> --lng <lng> --line <lineNo> [--station <name>]',
    '',
    'Examples:',
    '  node scripts/chelaile-fast.js nearby --lat 24.790420789217144 --lng 113.65760519230128',
    '  node scripts/chelaile-fast.js station --city-id 241 --station 市一中',
    '  node scripts/chelaile-fast.js realtime --city-id 241 --station 市一中 --line 7',
    '  node scripts/chelaile-fast.js route --city-id 241 --line 7 --station 市一中'
  ];
  console.log(lines.join('\n'));
}

function printJsonIfNeeded(args, value) {
  if (args.json) {
    console.log(JSON.stringify(value, null, 2));
    return true;
  }
  return false;
}

async function cmdNearby(ctx, args) {
  ensure(ctx.lat && ctx.lng, 'nearby mode requires --lat and --lng');
  await resolveCity(ctx);
  const [stations, nearStops] = await Promise.all([getNearbyStations(ctx), getNearbyLines(ctx)]);

  const flattened = nearStops.flatMap((stop) =>
    (stop.lines || []).map((entry) => ({
      stopName: stop.sn,
      stopDistance: stop.distance,
      lineNo: entry.line.lineNo || entry.line.name,
      directionLabel: directionLabel(entry.line),
      eta: entry.stnStates && entry.stnStates.length ? minuteText(entry.stnStates[0]) : '-',
      targetStation: entry.targetStation && entry.targetStation.sn,
      nextStation: entry.nextStation && entry.nextStation.sn
    }))
  );

  const result = {
    cityId: ctx.cityId,
    cityName: ctx.cityName,
    stations: stations.slice(0, 8),
    nearbyLineHits: flattened.slice(0, 12)
  };
  if (printJsonIfNeeded(args, result)) {
    return;
  }

  console.log(`City: ${ctx.cityName || '-'} (${ctx.cityId})`);
  console.log(`Nearby stations: ${stations.length}`);
  stations.slice(0, 8).forEach((station) => {
    console.log(`- ${station.sn} | sId=${station.sId} | distance=${station.distance}m`);
  });
  console.log('');
  console.log(`Nearby line hits: ${flattened.length}`);
  flattened.slice(0, 12).forEach((item) => {
    console.log(`- ${item.stopName} | ${item.lineNo} | ${item.directionLabel} | eta=${item.eta}`);
  });
}

async function cmdStation(ctx, args) {
  await resolveCity(ctx);
  const station = await resolveStation(ctx, args);
  if (!ctx.lat && !ctx.lng && station.lat && station.lng) {
    ctx.lat = station.lat;
    ctx.lng = station.lng;
    ctx.gpstype = station.gpstype || ctx.gpstype;
  }

  const detail = await getStationDetail(ctx, station.sId);
  let lines = detail.lines || [];
  if (args.line) {
    lines = lines.filter((entry) => lineMatches(args.line, entry.line));
  }
  const summaries = lines.map(stationLineSummary);

  const result = {
    cityId: ctx.cityId,
    cityName: ctx.cityName,
    station: {
      sId: detail.sId || station.sId,
      sn: detail.sn || station.sn,
      lat: station.lat,
      lng: station.lng,
      source: station.source
    },
    lines: summaries
  };
  if (printJsonIfNeeded(args, result)) {
    return;
  }

  console.log(`City: ${ctx.cityName || '-'} (${ctx.cityId})`);
  console.log(`Station: ${detail.sn || station.sn} (${detail.sId || station.sId})`);
  console.log(`Line count: ${summaries.length}`);
  summaries.forEach((item) => {
    console.log(`- ${item.lineNo} | ${item.directionLabel} | target=#${item.targetOrder} | next=${item.nextStationName} | eta=${item.eta}`);
  });
}

async function cmdRealtime(ctx, args) {
  ensure(args.line, 'realtime mode requires --line');
  await resolveCity(ctx);
  const station = await resolveStation(ctx, args);
  if (!ctx.lat && !ctx.lng && station.lat && station.lng) {
    ctx.lat = station.lat;
    ctx.lng = station.lng;
    ctx.gpstype = station.gpstype || ctx.gpstype;
  }

  const stationDetail = await getStationDetail(ctx, station.sId);
  const matches = (stationDetail.lines || []).filter((entry) => lineMatches(args.line, entry.line));
  ensure(matches.length > 0, `No line match for ${args.line} at station ${stationDetail.sn || station.sn}`);

  const details = await Promise.all(
    matches.map(async (entry) => {
      const lineDetail = await getLineDetail(ctx, {
        lineId: entry.line.lineId,
        lineName: entry.line.name || entry.line.lineNo,
        direction: entry.line.direction,
        stationName: entry.targetStation.sn,
        nextStationName: entry.nextStation.sn,
        lineNo: entry.line.lineNo || entry.line.name,
        targetOrder: entry.targetStation.order
      });
      const buses = (lineDetail.buses || [])
        .map((bus) => formatBus(bus, lineDetail.targetOrder))
        .sort((left, right) => left.diff - right.diff)
        .slice(0, 5);
      return {
        lineNo: entry.line.lineNo || entry.line.name,
        lineId: entry.line.lineId,
        direction: entry.line.direction,
        directionLabel: directionLabel(lineDetail.line || entry.line),
        targetStation: entry.targetStation.sn,
        targetOrder: entry.targetStation.order,
        nextStation: entry.nextStation.sn,
        tip: lineDetail.tip && lineDetail.tip.desc || lineDetail.line && (lineDetail.line.desc || lineDetail.line.shortDesc) || '',
        busCount: (lineDetail.buses || []).length,
        buses
      };
    })
  );

  const result = {
    cityId: ctx.cityId,
    cityName: ctx.cityName,
    station: {
      sId: stationDetail.sId || station.sId,
      sn: stationDetail.sn || station.sn
    },
    realtime: details
  };
  if (printJsonIfNeeded(args, result)) {
    return;
  }

  console.log(`City: ${ctx.cityName || '-'} (${ctx.cityId})`);
  console.log(`Station: ${stationDetail.sn || station.sn} (${stationDetail.sId || station.sId})`);
  details.forEach((item) => {
    console.log('');
    console.log(`${item.lineNo} | ${item.directionLabel}`);
    console.log(`target=#${item.targetOrder} ${item.targetStation} | next=${item.nextStation}`);
    console.log(`tip=${item.tip || '-'} | buses=${item.busCount}`);
    item.buses.forEach((bus) => {
      console.log(`- bus=${bus.busId} | order=${bus.order} | distance=${bus.distance} | eta=${bus.travel} | time=${bus.timeStr}`);
    });
  });
}

async function cmdRoute(ctx, args) {
  ensure(args.line, 'route mode requires --line');
  await resolveCity(ctx);

  let lines = await searchList(ctx, args.line, '1');
  lines = (lines.lines || []).filter((item) => lineMatches(args.line, item));
  if (lines.length <= 1) {
    const cityLines = await getCityLineList(ctx);
    const extra = cityLines.filter((item) => lineMatches(args.line, item));
    const merged = [...lines, ...extra];
    lines = dedupeBy(merged, (item) => item.lineId);
  }
  ensure(lines.length > 0, `No line found for ${args.line}`);

  const routes = await Promise.all(
    lines.map(async (line) => {
      const route = await getLineRoute(ctx, line.lineId);
      const stations = route.stations || [];
      const target = args.station
        ? stations.find((station) => stationMatches(args.station, station))
        : null;
      let label = route.line ? directionLabel(route.line) : directionLabel(line);
      if (label === '- -> -' && stations.length) {
        label = `${stations[0].sn} -> ${stations[stations.length - 1].sn}`;
      }
      return {
        lineId: line.lineId,
        lineNo: route.line && (route.line.lineNo || route.line.name) || line.lineNo || line.name,
        directionLabel: label,
        stationCount: stations.length,
        target,
        stations
      };
    })
  );

  const result = {
    cityId: ctx.cityId,
    cityName: ctx.cityName,
    routes: routes.map((item) => ({
      lineId: item.lineId,
      lineNo: item.lineNo,
      directionLabel: item.directionLabel,
      stationCount: item.stationCount,
      target: item.target,
      stations: item.stations
    }))
  };
  if (printJsonIfNeeded(args, result)) {
    return;
  }

  console.log(`City: ${ctx.cityName || '-'} (${ctx.cityId})`);
  routes.forEach((item) => {
    console.log('');
    console.log(`${item.lineNo} | ${item.directionLabel} | stations=${item.stationCount}`);
    if (item.target) {
      console.log(`target station: ${item.target.sn} | order=#${item.target.order}`);
    }
    item.stations.forEach((station) => {
      console.log(`- #${station.order} ${station.sn}`);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === 'help' || command === '--help') {
    printUsage();
    return;
  }

  const ctx = buildContext(args);
  switch (command) {
    case 'nearby':
      await cmdNearby(ctx, args);
      return;
    case 'station':
      await cmdStation(ctx, args);
      return;
    case 'realtime':
      await cmdRealtime(ctx, args);
      return;
    case 'route':
      await cmdRoute(ctx, args);
      return;
    default:
      printUsage();
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});

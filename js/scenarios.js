(function (global) {
  'use strict';

  function rand(min, max) {
    return Math.round(min + Math.random() * (max - min));
  }

  function makePing(lossPct, avg, jitter, base) {
    const sent = 5;
    const lost = Math.round(sent * lossPct / 100);
    const received = sent - lost;
    const times = [];
    const offs = [1, -1, 0.5, -0.8, 0.3, -0.5, 0.9, -1];
    for (let i = 0; i < received; i++) {
      times.push(avg + jitter * offs[i % offs.length] + rand(-1, 1));
    }
    return {
      sent, received, lost,
      lossPct,
      unreachable: 0, timeouts: lost,
      min: received ? Math.min(...times) : null,
      max: received ? Math.max(...times) : null,
      avg: received ? Math.round(times.reduce((a, b) => a + b, 0) / received) : null,
      jitter: received ? Math.round(Math.max(...times) - Math.min(...times)) : 0,
      times,
      base: base || 'simulated'
    };
  }

  function makeWifi(connected, signalPct, ssid, channel, opts) {
    opts = opts || {};
    return {
      available: opts.available !== false,
      connected,
      data: connected ? {
        ssid: ssid || 'SimNet', signalPct,
        channel: String(channel || 6), radioType: opts.radio || '802.11n',
        auth: opts.auth || 'WPA2-Personal', state: 'connected',
        rxRate: opts.rx || '65', txRate: opts.tx || '65'
      } : null
    };
  }

  function makeTrace(hops) {
    return {
      hops: hops.map((h, i) => {
        const times = [];
        const sampleCount = 3;
        for (let k = 0; k < sampleCount; k++) {
          if (h.loss === 100) times.push(null);
          else times.push(h.loss > 0 && k === 0 ? null : h.avg + rand(-Math.max(1, h.jit || 2), h.jit || 2));
        }
        const samples = times.filter(t => t !== null).length;
        return {
          hop: i + 1,
          times,
          lossPct: Math.round(((sampleCount - samples) / sampleCount) * 100),
          ip: h.loss === 100 ? 'Request timed out' : (h.ip || '10.0.' + (i + 1) + '.' + 1)
        };
      })
    };
  }

  function makeDns(ok, server, lookupMs) {
    return ok
      ? { server: server || 'dns.google', address: server || '8.8.8.8', lookupMs: lookupMs || rand(18, 90) }
      : { server: null, address: null, lookupMs: 4000 };
  }

  function baseData(mode, opts) {
    opts = opts || {};
    return {
      mode,
      meta: opts.meta || {},
      wifi: opts.wifi || makeWifi(false, 0, null, null, { available: false }),
      connectivity: opts.connectivity || {},
      dns: opts.dns || makeDns(false, null, 4000),
      trace: opts.trace || makeTrace([]),
      neighbors: opts.neighbors || [],
      interfaces: opts.interfaces || []
    };
  }

  const LAN_IFACES = [
    { name: 'Ethernet', adminState: 'Enabled', state: 'Connected', type: 'Dedicated' },
    { name: 'Wi-Fi', adminState: 'Enabled', state: 'Disconnected', type: 'Dedicated' }
  ];
  const WIFI_IFACES = [
    { name: 'Wi-Fi', adminState: 'Enabled', state: 'Connected', type: 'Dedicated' },
    { name: 'Ethernet', adminState: 'Enabled', state: 'Disconnected', type: 'Dedicated' }
  ];
  const MOBILE_IFACES = [
    { name: 'Cellular (4G/5G)', adminState: 'Enabled', state: 'Connected', type: 'Dedicated' }
  ];

  const healthyIface = (ip, gw, dhcpSrv, name) => ({
    name: name || 'Wi-Fi', ipv4: ip, subnet: '255.255.255.0', gateway: gw,
    dhcp: true, dhcpServer: dhcpSrv || gw, mac: 'AA:BB:CC:DD:EE:FF', apipa: false
  });

  function healthyTrace() {
    return makeTrace([
      { avg: 3, jit: 1, loss: 0, ip: '192.168.1.1' },
      { avg: 12, jit: 3, loss: 0, ip: '100.64.0.1' },
      { avg: 28, jit: 4, loss: 0, ip: '103.86.99.2' },
      { avg: 42, jit: 5, loss: 0, ip: '142.250.1.1' },
      { avg: 52, jit: 6, loss: 0, ip: '8.8.8.8' }
    ]);
  }

  const scenarios = {
    lan: [
      {
        id: 'lan-healthy', name: 'Healthy LAN', tag: 'Wired - Normal',
        desc: 'Ethernet cable connected, all diagnostics are normal.',
        generate: function () {
          return baseData('lan', {
            wifi: makeWifi(false, 0, null, null, { available: false }),
            connectivity: {
              gateway: '192.168.1.1', hasGateway: true, gatewayReachable: true, internetReachable: true,
              pings: {
                gateway: makePing(0, 2, 1),
                internet: makePing(0, 45, 8),
                alt: makePing(0, 40, 7)
              },
              activeIface: healthyIface('192.168.1.5', '192.168.1.1', '192.168.1.1', 'Ethernet')
            },
            dns: makeDns(true, '8.8.8.8', 30),
            trace: healthyTrace(),
            interfaces: LAN_IFACES
          });
        }
      },
      {
        id: 'lan-cable', name: 'Bad Cable / Link Down', tag: 'Physical Layer',
        desc: 'Ethernet cable is damaged - link cannot stay up, gateway is unreachable.',
        generate: function () {
          return baseData('lan', {
            wifi: makeWifi(false, 0, null, null, { available: false }),
            connectivity: {
              gateway: '192.168.1.1', hasGateway: true, gatewayReachable: false, internetReachable: false,
              pings: {
                gateway: makePing(100, null, 0),
                internet: makePing(100, null, 0),
                alt: makePing(100, null, 0)
              },
              activeIface: { name: 'Ethernet', ipv4: '192.168.1.5', subnet: '255.255.255.0', gateway: '192.168.1.1', dhcp: true, dhcpServer: '192.168.1.1', mac: '80:C1:6E:40:50:CC', apipa: false }
            },
            dns: makeDns(false, null, 4000),
            trace: makeTrace([
              { avg: 1, jit: 0, loss: 100, ip: '192.168.1.1' }
            ]),
            interfaces: [{ name: 'Ethernet', adminState: 'Enabled', state: 'Disconnected', type: 'Dedicated' }]
          });
        }
      },
      {
        id: 'lan-congestion', name: 'Network Congestion', tag: 'Network Layer',
        desc: 'High load - high RTT, 25% of the packets are dropped.',
        generate: function () {
          return baseData('lan', {
            wifi: makeWifi(false, 0, null, null, { available: false }),
            connectivity: {
              gateway: '192.168.1.1', hasGateway: true, gatewayReachable: true, internetReachable: true,
              pings: {
                gateway: makePing(5, 4, 3),
                internet: makePing(25, 185, 45),
                alt: makePing(20, 175, 40)
              },
              activeIface: healthyIface('192.168.1.5', '192.168.1.1', '192.168.1.1', 'Ethernet')
            },
            dns: makeDns(true, '8.8.8.8', 140),
            trace: makeTrace([
              { avg: 3, jit: 2, loss: 0, ip: '192.168.1.1' },
              { avg: 15, jit: 5, loss: 0, ip: '100.64.0.1' },
              { avg: 60, jit: 30, loss: 33, ip: '103.86.99.2' },
              { avg: 120, jit: 40, loss: 33, ip: '142.250.1.1' },
              { avg: 185, jit: 45, loss: 33, ip: '8.8.8.8' }
            ]),
            interfaces: LAN_IFACES
          });
        }
      },
      {
        id: 'lan-duplex', name: 'Duplex Mismatch', tag: 'Data Link Layer',
        desc: 'NIC/router duplex mismatch - collisions, unpredictable loss.',
        generate: function () {
          return baseData('lan', {
            wifi: makeWifi(false, 0, null, null, { available: false }),
            connectivity: {
              gateway: '192.168.1.1', hasGateway: true, gatewayReachable: true, internetReachable: true,
              pings: {
                gateway: makePing(45, 30, 25),
                internet: makePing(30, 140, 35),
                alt: makePing(28, 135, 33)
              },
              activeIface: healthyIface('192.168.1.5', '192.168.1.1', '192.168.1.1', 'Ethernet')
            },
            dns: makeDns(true, '8.8.8.8', 60),
            trace: makeTrace([
              { avg: 4, jit: 6, loss: 33, ip: '192.168.1.1' },
              { avg: 18, jit: 8, loss: 0, ip: '100.64.0.1' },
              { avg: 60, jit: 20, loss: 33, ip: '103.86.99.2' },
              { avg: 110, jit: 25, loss: 33, ip: '142.250.1.1' },
              { avg: 140, jit: 35, loss: 33, ip: '8.8.8.8' }
            ]),
            interfaces: LAN_IFACES
          });
        }
      },
      {
        id: 'lan-dhcp', name: 'DHCP Server Down', tag: 'Network Layer',
        desc: 'The router DHCP service is down - the system is taking an APIPA 169.254 address.',
        generate: function () {
          return baseData('lan', {
            wifi: makeWifi(false, 0, null, null, { available: false }),
            connectivity: {
              gateway: null, hasGateway: false, gatewayReachable: false, internetReachable: false,
              pings: { internet: makePing(100, null, 0), alt: makePing(100, null, 0) },
              activeIface: { name: 'Ethernet', ipv4: '169.254.23.45', subnet: '255.255.0.0', gateway: null, dhcp: true, dhcpServer: null, mac: '80:C1:6E:40:50:CC', apipa: true }
            },
            dns: makeDns(false, null, 4000),
            trace: makeTrace([]),
            interfaces: LAN_IFACES
          });
        }
      }
    ],

    wifi: [
      {
        id: 'wifi-healthy', name: 'Healthy WiFi', tag: 'Normal',
        desc: 'Strong signal, low jitter, everything is normal.',
        generate: function () {
          return baseData('wifi', {
            wifi: makeWifi(true, 85, 'HomeNet', 6),
            connectivity: {
              gateway: '192.168.1.1', hasGateway: true, gatewayReachable: true, internetReachable: true,
              pings: {
                gateway: makePing(0, 3, 2),
                internet: makePing(0, 48, 9),
                alt: makePing(0, 44, 8)
              },
              activeIface: healthyIface('192.168.1.5', '192.168.1.1', '192.168.1.1', 'Wi-Fi')
            },
            dns: makeDns(true, '8.8.8.8', 28),
            trace: healthyTrace(),
            interfaces: WIFI_IFACES
          });
        }
      },
      {
        id: 'wifi-interference', name: 'Channel Interference', tag: 'Data Link Layer',
        desc: 'Neighboring APs on the same channel - high jitter and retransmissions.',
        generate: function () {
          return baseData('wifi', {
            neighbors: [
              { ssid: 'NeighborA', signalPct: 68, channel: '6', radioType: '802.11n', auth: 'WPA2' },
              { ssid: 'NeighborB', signalPct: 55, channel: '6', radioType: '802.11n', auth: 'WPA2' },
              { ssid: 'NeighborC', signalPct: 45, channel: '1', radioType: '802.11g', auth: 'WPA' }
            ],
            wifi: makeWifi(true, 82, 'HomeNet', 6),
            connectivity: {
              gateway: '192.168.1.1', hasGateway: true, gatewayReachable: true, internetReachable: true,
              pings: {
                gateway: makePing(10, 12, 40),
                internet: makePing(15, 120, 80),
                alt: makePing(12, 115, 75)
              },
              activeIface: healthyIface('192.168.1.5', '192.168.1.1', '192.168.1.1', 'Wi-Fi')
            },
            dns: makeDns(true, '8.8.8.8', 55),
            trace: makeTrace([
              { avg: 5, jit: 25, loss: 33, ip: '192.168.1.1' },
              { avg: 22, jit: 30, loss: 0, ip: '100.64.0.1' },
              { avg: 65, jit: 40, loss: 33, ip: '103.86.99.2' },
              { avg: 100, jit: 45, loss: 33, ip: '142.250.1.1' },
              { avg: 120, jit: 50, loss: 33, ip: '8.8.8.8' }
            ]),
            interfaces: WIFI_IFACES
          });
        }
      },
      {
        id: 'wifi-weak', name: 'Weak Signal / Far Range', tag: 'Data Link Layer',
        desc: 'Too far from the router - signal 32%, intermittent drops.',
        generate: function () {
          return baseData('wifi', {
            wifi: makeWifi(true, 32, 'HomeNet', 11),
            connectivity: {
              gateway: '192.168.1.1', hasGateway: true, gatewayReachable: true, internetReachable: true,
              pings: {
                gateway: makePing(15, 8, 15),
                internet: makePing(35, 160, 55),
                alt: makePing(30, 155, 50)
              },
              activeIface: healthyIface('192.168.1.5', '192.168.1.1', '192.168.1.1', 'Wi-Fi')
            },
            dns: makeDns(true, '8.8.8.8', 120),
            trace: makeTrace([
              { avg: 4, jit: 8, loss: 33, ip: '192.168.1.1' },
              { avg: 25, jit: 15, loss: 0, ip: '100.64.0.1' },
              { avg: 80, jit: 25, loss: 33, ip: '103.86.99.2' },
              { avg: 130, jit: 30, loss: 33, ip: '142.250.1.1' },
              { avg: 160, jit: 55, loss: 33, ip: '8.8.8.8' }
            ]),
            interfaces: WIFI_IFACES
          });
        }
      },
      {
        id: 'wifi-auth', name: 'Authentication Failure', tag: 'Data Link Layer',
        desc: 'Wrong password - cannot connect to the AP.',
        generate: function () {
          return baseData('wifi', {
            wifi: makeWifi(false, 0, 'HomeNet', 6),
            connectivity: {
              gateway: null, hasGateway: false, gatewayReachable: false, internetReachable: false,
              pings: { internet: makePing(100, null, 0), alt: makePing(100, null, 0) },
              activeIface: null
            },
            dns: makeDns(false, null, 4000),
            trace: makeTrace([]),
            interfaces: WIFI_IFACES
          });
        }
      },
      {
        id: 'wifi-users', name: 'Too Many Users', tag: 'Network Layer',
        desc: 'Airtime is congested - 20 users connected, delay spikes.',
        generate: function () {
          return baseData('wifi', {
            wifi: makeWifi(true, 78, 'HomeNet', 6),
            connectivity: {
              gateway: '192.168.1.1', hasGateway: true, gatewayReachable: true, internetReachable: true,
              pings: {
                gateway: makePing(8, 6, 12),
                internet: makePing(30, 210, 25),
                alt: makePing(28, 200, 22)
              },
              activeIface: healthyIface('192.168.1.5', '192.168.1.1', '192.168.1.1', 'Wi-Fi')
            },
            dns: makeDns(true, '8.8.8.8', 200),
            trace: makeTrace([
              { avg: 5, jit: 10, loss: 0, ip: '192.168.1.1' },
              { avg: 30, jit: 20, loss: 0, ip: '100.64.0.1' },
              { avg: 110, jit: 35, loss: 33, ip: '103.86.99.2' },
              { avg: 170, jit: 40, loss: 33, ip: '142.250.1.1' },
              { avg: 210, jit: 50, loss: 33, ip: '8.8.8.8' }
            ]),
            interfaces: WIFI_IFACES
          });
        }
      }
    ],

    mobile: [
      {
        id: 'mob-healthy', name: 'Healthy Mobile Network', tag: '4G - Normal',
        desc: 'Strong RSRP, low latency, data session active.',
        generate: function () {
          return baseData('mobile', {
            meta: { signalLabel: 'RSRP -82 dBm' },
            wifi: makeWifi(true, 88, 'Carrier4G', 3),
            connectivity: {
              gateway: '10.64.64.1', hasGateway: true, gatewayReachable: true, internetReachable: true,
              pings: {
                gateway: makePing(0, 8, 3),
                internet: makePing(0, 55, 12),
                alt: makePing(0, 50, 11)
              },
              activeIface: healthyIface('10.64.5.9', '10.64.64.1', '10.64.64.1', 'Cellular')
            },
            dns: makeDns(true, '1.1.1.1', 34),
            trace: healthyTrace(),
            interfaces: MOBILE_IFACES
          });
        }
      },
      {
        id: 'mob-coverage', name: 'Weak Coverage', tag: 'Physical Layer',
        desc: 'Too far from the tower - RSRP -112 dBm, packets are dropped.',
        generate: function () {
          return baseData('mobile', {
            meta: { signalLabel: 'RSRP -112 dBm (poor)' },
            wifi: makeWifi(true, 18, 'Carrier4G', 3),
            connectivity: {
              gateway: '10.64.64.1', hasGateway: true, gatewayReachable: true, internetReachable: true,
              pings: {
                gateway: makePing(20, 40, 25),
                internet: makePing(45, 220, 60),
                alt: makePing(40, 210, 55)
              },
              activeIface: healthyIface('10.64.5.9', '10.64.64.1', '10.64.64.1', 'Cellular')
            },
            dns: makeDns(true, '1.1.1.1', 300),
            trace: makeTrace([
              { avg: 12, jit: 10, loss: 33, ip: '10.64.64.1' },
              { avg: 40, jit: 20, loss: 33, ip: '10.64.0.1' },
              { avg: 90, jit: 30, loss: 33, ip: '103.86.99.2' },
              { avg: 180, jit: 40, loss: 33, ip: '142.250.1.1' },
              { avg: 220, jit: 60, loss: 33, ip: '8.8.8.8' }
            ]),
            interfaces: MOBILE_IFACES
          });
        }
      },
      {
        id: 'mob-apn', name: 'APN Misconfiguration', tag: 'Network Layer',
        desc: 'Carrier APN is wrong - no data session, internet fails while calls still work.',
        generate: function () {
          return baseData('mobile', {
            meta: { signalLabel: 'RSRP -78 dBm' },
            wifi: makeWifi(true, 75, 'Carrier4G', 3),
            connectivity: {
              gateway: '10.64.64.1', hasGateway: true, gatewayReachable: true, internetReachable: false,
              pings: {
                gateway: makePing(0, 9, 3),
                internet: makePing(100, null, 0),
                alt: makePing(100, null, 0)
              },
              activeIface: healthyIface('10.64.5.9', '10.64.64.1', '10.64.64.1', 'Cellular')
            },
            dns: makeDns(false, null, 4000),
            trace: makeTrace([
              { avg: 8, jit: 3, loss: 0, ip: '10.64.64.1' },
              { avg: 14, jit: 4, loss: 0, ip: '10.64.0.1' },
              { avg: 22, jit: 5, loss: 100, ip: 'Request timed out' }
            ]),
            interfaces: MOBILE_IFACES
          });
        }
      },
      {
        id: 'mob-congestion', name: 'Carrier Congestion', tag: 'Network Layer',
        desc: 'Peak hours - overload on the carrier network, latency 250ms+.',
        generate: function () {
          return baseData('mobile', {
            meta: { signalLabel: 'RSRP -80 dBm' },
            wifi: makeWifi(true, 80, 'Carrier4G', 3),
            connectivity: {
              gateway: '10.64.64.1', hasGateway: true, gatewayReachable: true, internetReachable: true,
              pings: {
                gateway: makePing(5, 20, 8),
                internet: makePing(25, 260, 60),
                alt: makePing(22, 250, 55)
              },
              activeIface: healthyIface('10.64.5.9', '10.64.64.1', '10.64.64.1', 'Cellular')
            },
            dns: makeDns(true, '1.1.1.1', 250),
            trace: makeTrace([
              { avg: 10, jit: 5, loss: 0, ip: '10.64.64.1' },
              { avg: 45, jit: 15, loss: 0, ip: '10.64.0.1' },
              { avg: 140, jit: 30, loss: 33, ip: '103.86.99.2' },
              { avg: 220, jit: 40, loss: 33, ip: '142.250.1.1' },
              { avg: 260, jit: 60, loss: 33, ip: '8.8.8.8' }
            ]),
            interfaces: MOBILE_IFACES
          });
        }
      },
      {
        id: 'mob-tower', name: 'Tower Outage', tag: 'Physical Layer',
        desc: 'Nearest tower down - no service, no data session.',
        generate: function () {
          return baseData('mobile', {
            wifi: makeWifi(false, 0, null, null, { available: false }),
            connectivity: {
              gateway: null, hasGateway: false, gatewayReachable: false, internetReachable: false,
              pings: { internet: makePing(100, null, 0), alt: makePing(100, null, 0) },
              activeIface: null
            },
            dns: makeDns(false, null, 4000),
            trace: makeTrace([]),
            interfaces: MOBILE_IFACES
          });
        }
      }
    ]
  };

  function getScenarios(mode) {
    return (scenarios[mode] || scenarios.wifi).map(s => ({ id: s.id, name: s.name, desc: s.desc, tag: s.tag }));
  }

  function getScenario(mode, id) {
    return (scenarios[mode] || scenarios.wifi).find(s => s.id === id) || null;
  }

  global.NetFaultScenarios = { getScenarios, getScenario };
})(window);

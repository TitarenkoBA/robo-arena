import { decodePayload, makePayload } from './lan.service';

const FP = 'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90';

const CHROME_OFFER = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:3711434386 1 udp 2113937151 3b1e9d0a-6c2f-4f1e-9a51-7c1d2e3f4a5b.local 54400 typ host generation 0 network-cost 999',
  'a=candidate:842163049 1 udp 1677729535 93.184.216.34 54400 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999',
  'a=candidate:1 1 tcp 1518280447 192.168.1.5 9 typ host tcptype active generation 0',
  'a=ice-ufrag:Hx+/',
  'a=ice-pwd:Zk9vY+3P/qWEr1tYu2iOp3aS',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${FP}`,
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

const FIREFOX_ANSWER = [
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-99.0 1 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  `a=fingerprint:sha-256 ${FP}`,
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:0 1 UDP 2122252543 192.168.43.17 61203 typ host',
  'a=sendrecv',
  'a=end-of-candidates',
  'a=ice-pwd:1f2e3d4c5b6a79881f2e3d4c5b6a7988',
  'a=ice-ufrag:9a8b7c6d',
  'a=mid:0',
  'a=setup:active',
  'a=sctp-port:5000',
  'a=max-message-size:1073741823',
  '',
].join('\r\n');

describe('Офлайн-режим: кодирование QR', () => {
  it('приглашение Chrome сжимается и восстанавливается', () => {
    const code = makePayload('o', 'abc1', CHROME_OFFER);
    expect(code.startsWith('c')).toBe(true);
    expect(code.length).toBeLessThan(320);
    const url = `https://example.github.io/p2p-game/#/lan/${code}`;
    const p = decodePayload(url);
    expect(p.t).toBe('o');
    expect(p.i).toBe('abc1');
    expect(p.s).toContain('a=ice-ufrag:Hx+/');
    expect(p.s).toContain('a=ice-pwd:Zk9vY+3P/qWEr1tYu2iOp3aS');
    expect(p.s).toContain(`a=fingerprint:sha-256 ${FP}`);
    expect(p.s).toContain('3b1e9d0a-6c2f-4f1e-9a51-7c1d2e3f4a5b.local 54400 typ host');
    expect(p.s).toContain('93.184.216.34 54400 typ srflx raddr 0.0.0.0 rport 0');
    expect(p.s).not.toContain('tcp');
    expect(p.s).toContain('a=setup:actpass');
  });

  it('ответ Firefox (с префиксом RA:) восстанавливается', () => {
    const code = 'RA:' + makePayload('a', 'abc1', FIREFOX_ANSWER);
    const p = decodePayload(code);
    expect(p.t).toBe('a');
    expect(p.s).toContain('192.168.43.17 61203 typ host');
    expect(p.s).toContain('a=setup:active');
    expect(p.s).toContain('a=ice-ufrag:9a8b7c6d');
  });

  it('мусор вместо кода даёт понятную ошибку', () => {
    expect(() => decodePayload('hello world')).toThrowError(/QR/);
  });
});

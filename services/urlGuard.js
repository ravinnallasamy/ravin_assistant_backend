const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// RFC 6052 NAT64 well-known prefix: networks without native IPv4 (common on
// some ISPs/carriers) synthesize addresses in this range that embed a real
// IPv4 address in the low 32 bits. ipaddr.js classifies the range itself as
// 'rfc6052', not 'unicast', which would otherwise block every NAT64 client
// from reaching any IPv4-only host (e.g. github.com). Extract the embedded
// IPv4 and validate that instead of the synthetic IPv6 wrapper.
const NAT64_PREFIX = ipaddr.parse('64:ff9b::');

function extractNat64EmbeddedIPv4(addr) {
    const parts = addr.parts;
    const last32 = ((parts[6] << 16) | parts[7]) >>> 0;
    return [24, 16, 8, 0].map((shift) => (last32 >>> shift) & 0xff).join('.');
}

// Blocks SSRF: rejects URLs that resolve to loopback, private, link-local
// (including cloud metadata endpoints like 169.254.169.254), or otherwise
// non-routable addresses before the app ever fetches them.
function isDisallowedIp(address) {
    try {
        const addr = ipaddr.parse(address);

        if (addr.kind() === 'ipv6' && addr.match(NAT64_PREFIX, 96)) {
            const embeddedIPv4 = ipaddr.parse(extractNat64EmbeddedIPv4(addr));
            return embeddedIPv4.range() !== 'unicast';
        }

        const range = addr.range();
        return range !== 'unicast';
    } catch {
        return true;
    }
}

async function assertSafeUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('Invalid URL');
    }

    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
        throw new Error('Only http/https URLs are allowed');
    }

    if (parsed.username || parsed.password) {
        throw new Error('URLs with embedded credentials are not allowed');
    }

    const hostname = parsed.hostname;

    if (!hostname || hostname === 'localhost') {
        throw new Error('URL host is not allowed');
    }

    let addresses;
    try {
        addresses = await dns.lookup(hostname, { all: true });
    } catch {
        throw new Error('Unable to resolve URL host');
    }

    if (!addresses.length || addresses.some((a) => isDisallowedIp(a.address))) {
        throw new Error('URL resolves to a disallowed network address');
    }

    return parsed;
}

module.exports = { assertSafeUrl };

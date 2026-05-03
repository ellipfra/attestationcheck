#!/usr/bin/env node
const crypto = require('crypto');
const { verifyAttestation } = require('./verify');

const defaultChainId = 42161;
const GATEWAY = 'https://gateway.thegraph.com';

// Graph Network subgraph (Arbitrum). The id changes when a new version is published.
// Latest is documented at https://thegraph.com/explorer (search "Graph Network Arbitrum").
// Override at runtime via NETWORK_SUBGRAPH_ID env var.
const NETWORK_SUBGRAPH = process.env.NETWORK_SUBGRAPH_ID || 'DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp';

async function gatewayFetch(path, apiKey, query) {
    const res = await fetch(`${GATEWAY}${path}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { json = { errors: [{ message: text || `HTTP ${res.status}` }] }; }
    return { status: res.status, headers: res.headers, body: json };
}

async function gatewayFetchPinned(deploymentId, indexerAddress, apiKey, query) {
    const res = await fetch(
        `${GATEWAY}/api/deployments/id/${deploymentId}/indexers/id/${indexerAddress}`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query }),
        },
    );
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch (_) { body = { errors: [{ message: text || `HTTP ${res.status}` }] }; }
    const attestationHeader = res.headers.get('graph-attestation');
    let attestation = null;
    if (attestationHeader) {
        try { attestation = JSON.parse(attestationHeader); } catch (_) { /* ignore */ }
    }
    return { status: res.status, body, attestation };
}

async function listAllocatedIndexers(deploymentId, apiKey) {
    // Accept both Qm... and 0x... deployment ids; the network subgraph stores ipfsHash (Qm).
    const ipfsHash = deploymentId.startsWith('0x') ? null : deploymentId;
    const id = deploymentId.startsWith('0x') ? deploymentId.toLowerCase() : null;
    const filter = ipfsHash
        ? `subgraphDeployment_:{ipfsHash:"${ipfsHash}"}`
        : `subgraphDeployment:"${id}"`;
    const query = `{
      allocations(first: 100, where: { ${filter}, status: Active }) {
        id
        indexer { id url }
      }
    }`;
    const { body } = await gatewayFetch(
        `/api/subgraphs/id/${NETWORK_SUBGRAPH}`,
        apiKey,
        query,
    );
    if (body.errors) {
        throw new Error(`Network subgraph error: ${JSON.stringify(body.errors)}`);
    }
    return (body.data && body.data.allocations) || [];
}

function indexerLabel(url) {
    if (!url) return '(unknown)';
    try {
        const host = new URL(url).hostname;
        // IPv4: keep full address as label; second-to-last numeric octet is meaningless.
        if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
        const parts = host.split('.');
        return parts.length >= 2 ? parts[parts.length - 2] : host;
    } catch (_) {
        return url;
    }
}

function extractBlock(data) {
    if (data && data._meta && data._meta.block && data._meta.block.number !== undefined) {
        return data._meta.block.number;
    }
    return null;
}

function findLeaves(obj, path = []) {
    if (obj === null || obj === undefined) return [{ path, value: obj }];
    if (typeof obj !== 'object') return [{ path, value: obj }];
    if (Array.isArray(obj)) {
        if (obj.length === 0) return [{ path, value: '[]' }];
        return obj.flatMap((v, i) => findLeaves(v, [...path, `[${i}]`]));
    }
    return Object.entries(obj).flatMap(([k, v]) => findLeaves(v, [...path, k]));
}

function summarizeData(data) {
    if (!data || typeof data !== 'object') return String(data);
    const clone = { ...data };
    delete clone._meta;
    const leaves = findLeaves(clone);
    if (leaves.length === 0) return '—';
    if (leaves.length === 1) {
        const v = leaves[0].value;
        return v === null ? 'null' : String(v);
    }
    const json = JSON.stringify(clone);
    const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 8);
    if (json.length <= 80) return `${json} (#${hash})`;
    return `${json.slice(0, 60)}... (#${hash})`;
}

function ensureMetaBlock(query) {
    if (/\b_meta\b/.test(query)) return query;
    const lastBrace = query.lastIndexOf('}');
    if (lastBrace === -1) return query;
    return query.slice(0, lastBrace) + ' _meta { block { number } } ' + query.slice(lastBrace);
}

function pad(s, width) {
    s = String(s);
    if (s.length >= width) return s;
    return s + ' '.repeat(width - s.length);
}

function renderTable(headers, rows, maxColWidths) {
    const cols = headers.length;
    const widths = headers.map((h, i) => {
        const max = Math.max(h.length, ...rows.map(r => String(r[i]).length));
        return maxColWidths && maxColWidths[i] ? Math.min(max, maxColWidths[i]) : max;
    });
    const truncate = (s, w) => (String(s).length > w ? String(s).slice(0, w - 1) + '…' : String(s));
    const sep = (l, m, r) => l + widths.map(w => '─'.repeat(w + 2)).join(m) + r;
    const row = (cells) => '│ ' + cells.map((c, i) => pad(truncate(c, widths[i]), widths[i])).join(' │ ') + ' │';
    const lines = [];
    lines.push(sep('┌', '┬', '┐'));
    lines.push(row(headers));
    lines.push(sep('├', '┼', '┤'));
    for (const r of rows) lines.push(row(r));
    lines.push(sep('└', '┴', '┘'));
    return lines.join('\n');
}

async function main(deploymentId, query, apiKey, chainId) {
    const allocations = await listAllocatedIndexers(deploymentId, apiKey);
    if (allocations.length === 0) {
        console.error(`No active allocations found for deployment ${deploymentId}`);
        process.exit(2);
    }

    const effectiveQuery = ensureMetaBlock(query);

    console.log(`Deployment: ${deploymentId}`);
    console.log(`Active indexers: ${allocations.length}`);
    console.log();

    const rows = [];
    for (const alloc of allocations) {
        const addr = alloc.indexer.id;
        const url = alloc.indexer.url || '';
        const label = indexerLabel(url);

        let block = '—';
        let response = '—';
        let verified = '—';

        try {
            const { body, attestation } = await gatewayFetchPinned(deploymentId, addr, apiKey, effectiveQuery);
            if (body && body.data) {
                const blk = extractBlock(body.data);
                block = blk === null ? '—' : blk;
                response = summarizeData(body.data);
            } else if (body && body.errors) {
                response = `error: ${body.errors[0].message}`;
            }
            if (attestation) {
                const result = await verifyAttestation(attestation, chainId);
                if (result.indexer && result.indexer.toLowerCase() === addr.toLowerCase()) {
                    verified = 'YES';
                } else if (result.indexer) {
                    verified = `MISMATCH (${result.indexer})`;
                } else {
                    verified = `bad allocation ${result.allocationId}`;
                }
            } else {
                verified = 'no attestation';
            }
        } catch (e) {
            response = `request failed: ${e.message}`;
        }

        rows.push([label, addr, block, response, verified]);
    }

    const headers = ['Indexer', 'Address', 'Block', 'Response', 'Verified'];
    const maxColWidths = [16, 42, 10, 60, 30];
    console.log(renderTable(headers, rows, maxColWidths));
}

if (process.argv.length >= 5) {
    const [, , deploymentId, query, apiKey, chainArg] = process.argv;
    const chainId = chainArg ? parseInt(chainArg, 10) : defaultChainId;
    main(deploymentId, query, apiKey, chainId).catch(err => {
        console.error('Error:', err.message || err);
        process.exit(1);
    });
} else {
    console.error('Usage: compareindexer <deploymentId> "<graphql-query>" <apiKey> [chainId]');
    console.error('Example:');
    console.error('  compareindexer QmP1FMFsU4w... \'{ pool(id:"0x...") { totalValueLockedUSD } _meta { block { number } } }\' YOUR_API_KEY');
    process.exit(1);
}

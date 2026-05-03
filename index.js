#!/usr/bin/env node
const { verifyAttestation, getHorizon } = require('./verify');

const defaultChainId = 42161;

async function main(attestation, chainId) {
    const horizon = getHorizon(chainId);
    console.log('## Recovering signer');
    console.log(`  DisputeManager: ${horizon.DisputeManager}`);
    const result = await verifyAttestation(attestation, chainId);
    console.log(`  AllocationID:   ${result.allocationId}`);
    console.log('## Looking up on-chain allocation');
    if (!result.indexer) {
        throw new Error(`Allocation ${result.allocationId} not found in SubgraphService`);
    }
    console.log(`  Indexer:        ${result.indexer}  [${result.source}]`);
    if (result.service) {
        console.log(`  Indexer URL:    ${result.service.url}  (geo: ${result.service.geoHash})`);
    }
}

if (process.argv.length > 2) {
    const chainId = process.argv.length > 3 ? parseInt(process.argv[3], 10) : defaultChainId;
    try {
        const attestation = JSON.parse(process.argv[2]);
        main(attestation, chainId).catch(error => {
            console.error('Error:', error.message || error);
            process.exit(1);
        });
    } catch (error) {
        console.error('Invalid attestation JSON format:', error.message || error);
        process.exit(1);
    }
} else {
    console.error('Usage: attestationcheck <attestation-json> [chainId]');
    process.exit(1);
}

const { recoverAttestation } = require('@graphprotocol/common-ts');
const ethers = require('ethers');

const defaultChainId = 42161;
const AddressZero = '0x0000000000000000000000000000000000000000';

// Horizon (Subgraph Service) addresses, sourced from
// https://github.com/graphprotocol/contracts/blob/main/packages/subgraph-service/addresses.json
const horizonAddresses = {
    42161: {
        SubgraphService: '0xb2Bb92d0DE618878E438b55D5846cfecD9301105',
        DisputeManager: '0x2FE023a575449AcB698648eD21276293Fa176f96',
    },
    421614: {
        SubgraphService: '0xc24A3dAC5d06d771f657A48B20cE1a671B78f26b',
        DisputeManager: '0x96e1b86b2739e8A3d59F40F2532caDF9cE8Da088',
    },
};

const subgraphServiceAbi = [
    'function getAllocation(address allocationId) view returns (tuple(address indexer, bytes32 subgraphDeploymentId, uint256 tokens, uint256 createdAt, uint256 closedAt, uint256 lastPOIPresentedAt, uint256 accRewardsPerAllocatedToken, uint256 accRewardsPending, uint256 createdAtEpoch))',
    'function getLegacyAllocation(address allocationId) view returns (tuple(address indexer, bytes32 subgraphDeploymentId))',
    'function indexers(address indexer) view returns (string url, string geoHash)',
];

const chainId = process.argv.length > 3 ? parseInt(process.argv[3], 10) : defaultChainId;
const horizon = horizonAddresses[chainId];
if (!horizon) {
    console.error(`Unsupported chainId ${chainId}. Supported: ${Object.keys(horizonAddresses).join(', ')}`);
    process.exit(1);
}

const provider = ethers.getDefaultProvider(chainId);
const subgraphService = new ethers.Contract(horizon.SubgraphService, subgraphServiceAbi, provider);

async function lookupIndexer(allocationID) {
    try {
        const allocation = await subgraphService.getAllocation(allocationID);
        if (allocation.indexer !== AddressZero) {
            return { indexer: allocation.indexer, source: 'SubgraphService.getAllocation' };
        }
    } catch (e) {
        // ignore
    }
    try {
        const legacy = await subgraphService.getLegacyAllocation(allocationID);
        if (legacy.indexer !== AddressZero) {
            return { indexer: legacy.indexer, source: 'SubgraphService.getLegacyAllocation (migrated)' };
        }
    } catch (e) {
        // ignore
    }
    return null;
}

async function fetchIndexerService(indexerAddress) {
    try {
        const info = await subgraphService.indexers(indexerAddress);
        if (info && info.url) return { url: info.url, geoHash: info.geoHash };
    } catch (e) {
        // ignore
    }
    return null;
}

async function main(attestation) {
    console.log('## Recovering signer');
    console.log(`  DisputeManager: ${horizon.DisputeManager}`);
    const allocationID = recoverAttestation(chainId, horizon.DisputeManager, attestation, "0");
    console.log(`  AllocationID:   ${allocationID}`);

    console.log('## Looking up on-chain allocation');
    const found = await lookupIndexer(allocationID);
    if (!found) {
        throw new Error(`Allocation ${allocationID} not found in SubgraphService`);
    }
    console.log(`  Indexer:        ${found.indexer}  [${found.source}]`);
    const svc = await fetchIndexerService(found.indexer);
    if (svc) console.log(`  Indexer URL:    ${svc.url}  (geo: ${svc.geoHash})`);
}

if (process.argv.length > 2) {
    const attestationArg = process.argv[2];
    try {
        const attestation = JSON.parse(attestationArg);
        main(attestation).catch(error => {
            console.error('Error:', error.message || error);
            process.exit(1);
        });
    } catch (error) {
        console.error('Invalid attestation JSON format:', error);
        process.exit(1);
    }
} else {
    console.error('Usage: node index.js <attestation> [chainId]');
    process.exit(1);
}

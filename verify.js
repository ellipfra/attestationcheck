const { recoverAttestation } = require('@graphprotocol/common-ts');
const ethers = require('ethers');

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

function getHorizon(chainId) {
    const horizon = horizonAddresses[chainId];
    if (!horizon) {
        throw new Error(`Unsupported chainId ${chainId}. Supported: ${Object.keys(horizonAddresses).join(', ')}`);
    }
    return horizon;
}

function getSubgraphService(chainId) {
    const horizon = getHorizon(chainId);
    const provider = ethers.getDefaultProvider(chainId);
    return new ethers.Contract(horizon.SubgraphService, subgraphServiceAbi, provider);
}

async function lookupAllocation(subgraphService, allocationId) {
    try {
        const allocation = await subgraphService.getAllocation(allocationId);
        if (allocation.indexer !== AddressZero) {
            return { indexer: allocation.indexer, source: 'SubgraphService.getAllocation' };
        }
    } catch (e) { /* ignore */ }
    try {
        const legacy = await subgraphService.getLegacyAllocation(allocationId);
        if (legacy.indexer !== AddressZero) {
            return { indexer: legacy.indexer, source: 'SubgraphService.getLegacyAllocation (migrated)' };
        }
    } catch (e) { /* ignore */ }
    return null;
}

async function fetchIndexerService(subgraphService, indexerAddress) {
    try {
        const info = await subgraphService.indexers(indexerAddress);
        if (info && info.url) return { url: info.url, geoHash: info.geoHash };
    } catch (e) { /* ignore */ }
    return null;
}

async function verifyAttestation(attestation, chainId) {
    const horizon = getHorizon(chainId);
    const allocationId = recoverAttestation(chainId, horizon.DisputeManager, attestation, "0");
    const subgraphService = getSubgraphService(chainId);
    const found = await lookupAllocation(subgraphService, allocationId);
    if (!found) {
        return { allocationId, indexer: null, source: null, service: null };
    }
    const service = await fetchIndexerService(subgraphService, found.indexer);
    return { allocationId, indexer: found.indexer, source: found.source, service };
}

module.exports = {
    AddressZero,
    horizonAddresses,
    getHorizon,
    getSubgraphService,
    lookupAllocation,
    fetchIndexerService,
    verifyAttestation,
};

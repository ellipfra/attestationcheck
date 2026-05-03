# attestationcheck

## Description
Recovers the `AllocationID` from a Graph query attestation (EIP-712 signature) and resolves the indexer's on-chain address.

Supports the **Horizon** protocol only: the EIP-712 domain uses the SubgraphService DisputeManager as `verifyingContract`, and on-chain lookups go through the `SubgraphService` contract (`getAllocation`, with fallback to `getLegacyAllocation` for migrated allocations). Pre-Horizon attestations against the legacy `L2Staking` DisputeManager are not supported.

When an allocation is found, the indexer's URL and geohash declared in the SubgraphService registry are also printed.

## Installation
```bash
npm install
npm link    # optional, exposes the `attestationcheck` command globally
```

## Usage
```bash
attestationcheck '<attestation-json>' [chainId]
```

If you skipped `npm link`, equivalent invocations:
```bash
npx attestationcheck '<attestation-json>' [chainId]
./index.js '<attestation-json>' [chainId]
node index.js '<attestation-json>' [chainId]
```

- `attestation-json`: JSON object as returned by the gateway in the `graph-attestation` HTTP header (fields: `requestCID`, `responseCID`, `subgraphDeploymentID`, `r`, `s`, `v`). `v` may be 0/1 or 27/28.
- `chainId`: 42161 (Arbitrum One, default) or 421614 (Arbitrum Sepolia).

Example:
```bash
attestationcheck '{"requestCID":"0x...","responseCID":"0x...","subgraphDeploymentID":"0x...","r":"0x...","s":"0x...","v":27}'
```

To fetch an attestation from the gateway:
```bash
curl -i -X POST 'https://gateway.thegraph.com/api/<API_KEY>/subgraphs/id/<SUBGRAPH_ID>' \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ ... }"}'
```
The attestation is in the `graph-attestation` response header.

## Expected output
```
## Recovering signer
  DisputeManager: 0x2FE023...
  AllocationID:   0x...
## Looking up on-chain allocation
  Indexer:        0x...  [SubgraphService.getAllocation]
  Indexer URL:    https://...  (geo: ...)
```

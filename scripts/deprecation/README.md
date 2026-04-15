# RToken Deprecation

Deprecation permanently disables an RToken by executing a governance proposal that pauses issuance, stops auctions, redirects all revenue to RSR stakers, and renounces ownership. After deprecation, holders can still redeem their RTokens for underlying collateral, but no new issuance or governance actions are possible.

## Deprecation Actions

The proposal executes the following actions atomically through the timelock:

1. **Set batch auction length to 0** — stops all batch auctions
2. **Set issuance throttle to 1e18 (minimum)** — minimizes issuance capacity
3. **Grant PAUSER role to timelock** — needed for the next two steps
4. **Unpause trading** — safety measure ensuring stakers can unstake after deprecation
5. **Pause issuance** — blocks new minting (redemptions remain open)
6. **Set distribution to 0% RToken / 100% RSR** — redirects all revenue
7. **Remove all PAUSER roles** — including the timelock grant from step 3
8. **Remove all SHORT_FREEZER roles**
9. **Remove all LONG_FREEZER roles**
10. **Remove OWNER role from timelock** — **must be last** (irreversible)

## Workflow

### 1. Generate the Proposal JSON

Add or update the RToken config in `generate-deprecation-proposals.py`, then run:

```bash
cd scripts/deprecation
python3 generate-deprecation-proposals.py
```

This produces a Safe TX Builder JSON in `proposals/deprecate-<NAME>.json` containing a single `Governor.propose()` call wrapping all the actions above.

### 2. Pre-Submission Validation (Fork Test)

Before submitting on-chain, validate the proposal using the fork test template:

```bash
# Configure test/deprecation/deprecate-from-json.test.ts with:
#   - PROPOSAL_JSON path
#   - Contract addresses (GOVERNOR, TIMELOCK, MAIN, RTOKEN, BROKER)
#   - Role holders (PAUSERS, SHORT_FREEZERS, LONG_FREEZERS)
#   - RTOKEN_HOLDER for redemption test
#   - RSR_WHALE or StRSR delegation addresses

PROTO=p1 FORK=1 FORK_NETWORK=<mainnet|base|arbitrum> FORK_BLOCK=<block> \
  npx hardhat test test/deprecation/deprecate-from-json.test.ts
```

The test validates 7 post-conditions:

- Proposal executes through full governance lifecycle
- All roles removed (PAUSER, SHORT_FREEZER, LONG_FREEZER, OWNER)
- Issuance paused
- Batch auction length = 0
- Redemption still works
- New issuance blocked
- **Unstake and withdraw work** (trading not paused)

### 3. Submit via Safe TX Builder

Import the generated JSON into the Safe Transaction Builder UI and submit.

### 4. Post-Submission Validation

After the proposal is on-chain, validate using the on-chain proposal template:

```bash
# Configure test/deprecation/deprecate-onchain-proposal.test.ts with:
#   - PROPOSAL_JSON path (must match what was submitted)
#   - PROPOSAL_ID from on-chain
#   - Same contract addresses and role holders
#   - Use a FORK_BLOCK where the proposal exists

PROTO=p1 FORK=1 FORK_NETWORK=<mainnet|base|arbitrum> FORK_BLOCK=<block> \
  npx hardhat test test/deprecation/deprecate-onchain-proposal.test.ts
```

This verifies the JSON calldata matches the on-chain proposal ID before running the same 7 validations.

## Governor Types

Different RTokens use different governor implementations. The fork tests must advance time/blocks correctly:

| Governor                 | Clock Mode  | Voting Delay                       | Voting Period                      |
| ------------------------ | ----------- | ---------------------------------- | ---------------------------------- |
| **Governance** (Reserve) | timestamp   | `advanceTime`                      | `advanceBlocks`                    |
| **Governor Anastasius**  | timestamp   | `advanceTime` + `advanceBlocks(2)` | `advanceTime` + `advanceBlocks(2)` |
| **Governor Alexios**     | block-based | `advanceBlocks`                    | `advanceBlocks`                    |

To identify the governor type:

```bash
cast call <GOVERNOR> "name()(string)" --rpc-url <RPC>
cast call <GOVERNOR> "CLOCK_MODE()(string)" --rpc-url <RPC>  # reverts for Alexios
```

## Voting Power

### Mainnet

Use the RSR whale `0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1` — transfer RSR to tester, stake, and delegate before proposing.

### Base / Arbitrum

No consistent RSR whale exists. Instead, delegate from existing StRSR holders:

```bash
# Find StRSR holders via Alchemy
curl -s -X POST <RPC> -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"alchemy_getAssetTransfers","params":[{"fromBlock":"0x0","toBlock":"latest","contractAddresses":["<STRSR_ADDRESS>"],"category":["erc20"],"maxCount":"0x20","order":"desc"}]}'

# Check balances
cast call <STRSR> "balanceOf(address)(uint256)" <ADDR> --rpc-url <RPC>
```

Combined delegated StRSR must exceed `totalSupply * quorumNumerator / 100`.

## Pre-Execution Checklist

Before executing any deprecation proposal, verify:

- [ ] **Trading is NOT paused** — `main.tradingPausedOrFrozen() == false`
- [ ] **No open trades** — `rsrTrader.tradesOpen() == 0 && rTokenTrader.tradesOpen() == 0`
- [ ] **Fork test passes all 7 checks** including unstake/withdraw
- [ ] **Proposal ID matches** JSON calldata (for post-submission validation)

## Key Technical Notes

- **`setDistribution` (singular)**: Deployed v3.4.0 Distributor uses `setDistribution(address,(uint16,uint16))` (selector `0x88594437`), NOT `setDistributions` (plural). The script uses two separate calls: FURNACE=address(1) to (0,0) and ST_RSR=address(2) to (0,10000).

- **`pushOraclesForward`**: Required before `governor.execute()` and before redemption tests, as time advancement during the governance lifecycle causes oracle staleness.

- **ethers.js `Result.values()`**: When decoding `governor.propose()` calldata, use positional access (`decoded[0]`, `decoded[1]`) — the named field `values` collides with the ethers.js `Result.values()` method.

- **Redemption throttle**: Large redemptions on Base may hit the supply change throttle. Cap redemption amounts with `bal.gt(fp('1000')) ? fp('1000') : bal`.

- **RPC rate limits**: Alchemy is recommended over Infura for fork tests (Infura hits 429 rate limits on heavy fork usage).

## File Structure

```
scripts/deprecation/
├── README.md                              # This file
├── generate-deprecation-proposals.py      # Proposal generator script
└── proposals/                             # Generated Safe TX Builder JSONs
    ├── deprecate-BSDX.json
    ├── deprecate-KNOX.json
    ├── deprecate-MAAT.json
    ├── deprecate-USDCplus.json
    ├── deprecate-VAYA.json
    ├── deprecate-dgnETH.json
    ├── deprecate-hyUSD-base.json
    ├── deprecate-hyUSD-mainnet.json
    └── deprecate-rgUSD.json

test/deprecation/
├── deprecate-from-json.test.ts            # Template: pre-submission validation
└── deprecate-onchain-proposal.test.ts     # Template: post-submission validation
```

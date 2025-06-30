# Moonwell Morpho USDC Collateral Plugin

## Overview

The Moonwell Morpho USDC collateral plugin provides integration with the Moonwell Morpho USDC vault on Base network. This plugin allows the Reserve Protocol to use Moonwell Morpho USDC vault shares as collateral for RTokens.

## Vault Information

- **Vault Address**: `0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca`
- **Token Symbol**: `mwUSDC`
- **Network**: Base mainnet
- **Underlying Asset**: USDC

## Units

- **{tok}**: mwUSDC (Moonwell Morpho USDC vault share token)
- **{ref}**: USDC (underlying reference token)
- **{target}**: USD (target unit)
- **{UoA}**: USD (unit of account)

## Configuration

The plugin extends `AppreciatingFiatCollateral` and requires the following configuration:

### Constructor Parameters

- `config.erc20`: Must be the Moonwell Morpho USDC vault address (`0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca`)
- `config.chainlinkFeed`: USDC/USD price feed
- `config.defaultThreshold`: Must be non-zero
- `revenueHiding`: A small value (e.g., 1e-6) to hide maximum refPerTok

### Example Configuration

```typescript
const config = {
  erc20: '0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca',
  chainlinkFeed: '0x7e860098f58bbfc8648a4311b374b1d669a2bc6b', // USDC/USD on Base
  maxTradeVolume: ethers.utils.parseEther('1000000'),
  oracleTimeout: 86400,
  targetName: ethers.utils.formatBytes32String('USD'),
  defaultThreshold: ethers.utils.parseEther('0.01'),
  delayUntilDefault: 86400,
  priceTimeout: 86400,
  oracleError: ethers.utils.parseEther('0.005'),
}

const revenueHiding = ethers.utils.parseEther('0.000001')
```

## Features

- **ERC4626 Integration**: Uses the ERC4626 standard for vault share calculations
- **Price Oracle**: Integrates with Chainlink USDC/USD price feed
- **Revenue Hiding**: Implements revenue hiding to prevent manipulation
- **Reward Claims**: Supports claiming rewards from the vault (currently no-op)

## Usage

1. Deploy the `MoonwellMorphoUSDCCollateral` contract with the appropriate configuration
2. Add the deployed collateral to the Reserve Protocol's asset registry
3. Include the collateral in RToken basket configurations as needed

## Security Considerations

- The plugin validates the vault address during construction
- Default threshold must be non-zero to enable proper risk management
- Oracle timeouts and error bounds should be configured appropriately for Base network conditions

## Testing

Run the integration tests to verify the plugin functionality:

```bash
npx hardhat test test/plugins/individual-collateral/moonwellMorphoUSDC/MoonwellMorphoUSDCCollateral.test.ts
```

## Deployment

The plugin can be deployed using the standard Reserve Protocol deployment scripts. Ensure the Base network configuration includes the necessary token addresses and price feeds. 
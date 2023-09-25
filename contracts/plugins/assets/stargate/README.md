# Stargate Finance as collateral

This documentation outlines the configuration and deployment of the Collateral Plugin, which is designed to enable Stargate Liquidity pool tokens as Collateral for an Token. It also defines the collateral token, reference unit, and target unit, and provides guidelines for integrating price feeds.

The Stargate Finance documentation will be a good starting point to understand this plugin. Some quick links:

- [Stargate User documentation](https://stargateprotocol.gitbook.io/stargate/v/user-docs/)
- [Stargate Developer documentation](https://stargateprotocol.gitbook.io/stargate/)
- [Stargate LP Staking contract source code](https://etherscan.io/address/0xB0D502E938ed5f4df2E681fE6E419ff29631d62b#code#F1#L1)

> Users can add liquidity to token-chain pools (i.e. USDC-Ethereum) and receive either farm-based or transfer-based rewards
>
> _[From The Stargate User Docs](https://stargateprotocol.gitbook.io/stargate/v/user-docs/stargate-features/pool#overview)_

These rewards are added to the total available liquidity, thereby increasing the amount of the underlying token the LP token can be redeemed for. Users can also further stake their LP tokens with the [LPStaking](https://github.com/stargate-protocol/stargate/blob/main/contracts/LPStaking.sol) contract to receive $STG rewards.

It's therefore required to have a wrapper token that'll automatically stake and collect these rewards so it can be used as additional revenue for the collateral.

## Wrapper Token for Automatic Staking and Reward Collection

The wrapper token for automatic staking and reward collection is a smart contract that enables LP token holders to earn rewards automatically without the need to manually stake and collect rewards. It works by automatically staking the LP tokens deposited into the contract, and then collecting rewards in the form of additional tokens, which are then distributed proportionally to the token holders.

### Methods

The wrapper token has all ERC20 methods with the following additions:

- `deposit(uint amount)`: Allows users to deposit LP tokens into the wrapper token contract. The amount parameter specifies the number of LP tokens to deposit.
- `withdraw(uint amount)`: Allows users to withdraw LP tokens from the wrapper token contract. The amount parameter specifies the number of LP tokens to withdraw.

### Usage

To use the wrapper token for automatic staking and reward collection, follow these steps:

1. Obtain LP tokens from the Stargate Finance protocol.
2. Approve the wrapper token contract to spend your LP tokens by calling the `approve` function on the LP token contract with the wrapper token contract address as the parameter.
3. Deposit your LP tokens into the wrapper token contract by calling the `deposit` function with the amount parameter set to the number of LP tokens you wish to deposit.
4. The tokens are automatically staked and rewards start to accrue.
5. Withdraw your LP tokens from the wrapper token contract by calling the `withdraw` function with the amount parameter set to the number of LP tokens you wish to withdraw.

### Notes

- Pending rewards are automatically collected upon deposit and withdrawal.
- Token transfers don't transfer pending rewards along with the token.
- Always verify the contract address before interacting with it to avoid phishing attacks.

## Collateral plugin

There are 2 variants of this plugin:

1. **`StargatePoolFiatCollateral`**: This contract serves for the USDC, USDT and any other USD-pegged token. The target for these collaterals is **USD**. Ready for deployment and use.
2. **`StargatePoolETHCollateral`**: _DEPRECATED_. This contract serves the ETH pool. The underlying token for the Stargate ETH pool is SGETH which is mapped 1:1 with ETH. The chainlink feed that will then be provided during deployment would be an ETH-USD oracle. The target for this collateral is **ETH**. _Warning: Not ready to be used in Production_

The **`{ref/tok}`** is computed as the ratio of the total liquidity to the total LP tokens in circulation. This ratio never drops except for a very rare occasion where the pool's total supply drops to zero, in which case the **`{ref/tok}`** falls back to 1 and the plugin will default under such circumstances.

### Acounting units

| Unit                 | Description                                                |
| :------------------- | ---------------------------------------------------------- |
| **Collateral token** | The wrapper token deployed for that pool.                  |
| **Target unit**      | `USD` for the USD-pegged pools and `ETH` for the ETH pool. |
| **Reference unit**   | The pool's underlying token.                               |

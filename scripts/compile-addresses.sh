#!/bin/bash

# RTokens
# *** Ethereum Mainnet ***

# eUSD
npx hardhat get-addys --rtoken 0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F --gov 0x7e880d8bD9c9612D6A9759F96aCD23df4A4650E6 --network mainnet

# ETH+
npx hardhat get-addys --rtoken 0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8 --gov 0x239cDcBE174B4728c870A24F77540dAB3dC5F981 --network mainnet

# hyUSD
npx hardhat get-addys --rtoken 0xaCdf0DBA4B9839b96221a8487e9ca660a48212be --gov 0x22d7937438b4bBf02f6cA55E3831ABB94Bd0b6f1 --network mainnet

# USDC+
npx hardhat get-addys --rtoken 0xFc0B1EEf20e4c68B3DCF36c4537Cfa7Ce46CA70b --gov 0xc837C557071D604bCb1058c8c4891ddBe8FDD630 --network mainnet


# *** Base L2 ***

# hyUSD
npx hardhat get-addys --rtoken 0xCc7FF230365bD730eE4B352cC2492CEdAC49383e --gov 0xc8e63d3501A246fa1ddBAbe4ad0B50e9d32aA8bb --network base

# VAYA
npx hardhat get-addys --rtoken 0xC9a3e2B3064c1c0546D3D0edc0A748E9f93Cf18d --gov 0xEb583EA06501f92E994C353aD2741A35582987aA --network base


# Components
# *** Ethereum Mainnet ***
npx hardhat get-addys --ver "2.0.0" --network mainnet
npx hardhat get-addys --ver "2.1.0" --network mainnet
npx hardhat get-addys --ver "3.0.0" --network mainnet
npx hardhat get-addys --ver "3.0.1" --network mainnet

# *** Base L2 ***
npx hardhat get-addys --ver "3.0.0" --network base
npx hardhat get-addys --ver "3.0.1" --network base
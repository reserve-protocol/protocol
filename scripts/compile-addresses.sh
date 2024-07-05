#!/bin/bash

# RTokens
# *** Ethereum Mainnet ***

# eUSD
npx hardhat get-addys --rtoken 0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F --gov 0xf4A9288D5dEb0EaE987e5926795094BF6f4662F8 --network mainnet

# ETH+
npx hardhat get-addys --rtoken 0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8 --gov 0x868Fe81C276d730A1995Dc84b642E795dFb8F753 --network mainnet

# hyUSD
npx hardhat get-addys --rtoken 0xaCdf0DBA4B9839b96221a8487e9ca660a48212be --gov  0x3F26EF1460D21A99425569Ef3148Ca6059a7eEAe --network mainnet

# USDC+
npx hardhat get-addys --rtoken 0xFc0B1EEf20e4c68B3DCF36c4537Cfa7Ce46CA70b --gov 0xc837C557071D604bCb1058c8c4891ddBe8FDD630 --network mainnet

# USD3
npx hardhat get-addys --rtoken 0x0d86883FAf4FfD7aEb116390af37746F45b6f378 --gov 0x441808e20E625e0094b01B40F84af89436229279 --network mainnet

# *** Base L2 ***

# hyUSD
npx hardhat get-addys --rtoken 0xCc7FF230365bD730eE4B352cC2492CEdAC49383e --gov 0xffef97179f58a582dEf73e6d2e4BcD2BDC8ca128 --network base

# VAYA
npx hardhat get-addys --rtoken 0xC9a3e2B3064c1c0546D3D0edc0A748E9f93Cf18d --gov 0xEb583EA06501f92E994C353aD2741A35582987aA --network base

# bsdETH
npx hardhat get-addys --rtoken 0xCb327b99fF831bF8223cCEd12B1338FF3aA322Ff --gov 0x21fBa52dA03e1F964fa521532f8B8951fC212055 --network base


# Components
# *** Ethereum Mainnet ***
npx hardhat get-addys --ver "2.0.0" --network mainnet
npx hardhat get-addys --ver "2.1.0" --network mainnet
npx hardhat get-addys --ver "3.0.0" --network mainnet
npx hardhat get-addys --ver "3.0.1" --network mainnet
npx hardhat get-addys --ver "3.3.0" --network mainnet
npx hardhat get-addys --ver "3.4.0" --network mainnet

# *** Base L2 ***
npx hardhat get-addys --ver "3.0.0" --network base
npx hardhat get-addys --ver "3.0.1" --network base
npx hardhat get-addys --ver "3.3.0" --network base
npx hardhat get-addys --ver "3.4.0" --network base
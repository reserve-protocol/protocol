// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

// This file exists solely to force Hardhat to compile the trusted-fillers contracts
// These imports ensure the contracts are available for testing

import "@reserve-protocol/trusted-fillers/contracts/TrustedFillerRegistry.sol";
// Note: CowSwapFiller cannot be imported due to OpenZeppelin version conflict
// CowSwapFiller uses OZ 5.1.0 (Math.Rounding.Up) while protocol uses OZ 4.9.6 (Math.Rounding.Ceil)
// import "@reserve-protocol/trusted-fillers/contracts/fillers/cowswap/CowSwapFiller.sol";

// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IDeployer.sol";
import "contracts/interfaces/IAsset.sol";

function defaultParams() pure returns (DeploymentParams memory params) {
    params = DeploymentParams({
        tradingRange: TradingRange({ min: toFix(1) / 100, max: toFix(1e6) }), // 0.01 UoA (USD)
        dist: RevenueShare({ rTokenDist: 2, rsrDist: 3 }),
        rewardPeriod: 604800, // 1 week
        rewardRatio: FixLib.divu(toFix(22840), (1_000_000)), // approx. half life of 30 pay periods
        unstakingDelay: 1209600, // 2 weeks
        tradingDelay: 0, // (the delay _after_ default has been confirmed)
        auctionLength: 1800, // 30 minutes
        backingBuffer: FixLib.divu(toFix(1), 10000), // 0.01%, 1 BIP
        maxTradeSlippage: FixLib.divu(toFix(1), 100), // 1%
        issuanceRate: FixLib.divu(toFix(25), 1_000_000), // 0.025% per block or ~0.1% per minute
        oneshotFreezeDuration: 864000 // 10 days
    });
}

function defaultFreezeDuration() pure returns (uint32 duration) {
    return 1209600; // 2 weeks
}

// Assuming "seed" is an arbitrary value, return an arbitrary value in [low, high]
function between(
    uint256 low,
    uint256 high,
    uint256 seed
) pure returns (uint256) {
    return low + (seed % (high - low + 1));
}

function concat(string memory a, string memory b) pure returns (string memory) {
    return string(abi.encodePacked(a, b));
}

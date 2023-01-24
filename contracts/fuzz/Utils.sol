// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IDeployer.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/libraries/Throttle.sol";

function defaultParams() pure returns (DeploymentParams memory params) {
    // 1 {qRTok} per hour or 5% supply of {qRTok} per hour
    ThrottleLib.Params memory tParams = ThrottleLib.Params(
        {amtRate: 20000e18, pctRate: _safeWrap(5e16)}
    );

    params = DeploymentParams({
        dist: RevenueShare({ rTokenDist: 2, rsrDist: 3 }),
        minTradeVolume: 1e22,
        rTokenMaxTradeVolume: 1e24,
        shortFreeze: 345600, // 4 days
        longFreeze: 1814400, // 3 weeks
        rewardRatio: FixLib.divu(toFix(22840), (1_000_000)), // approx. half life of 30 pay periods
        unstakingDelay: 1209600, // 2 weeks
        tradingDelay: 0, // (the delay _after_ default has been confirmed)
        auctionLength: 1800, // 30 minutes
        backingBuffer: FixLib.divu(toFix(1), 10000), // 0.01%, 1 BIP
        maxTradeSlippage: FixLib.divu(toFix(1), 100), // 1%
        issuanceThrottle: tParams,
        redemptionThrottle: tParams
    });
}

function defaultFreezeDuration() pure returns (uint48 duration) {
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

function concat(
    string memory a,
    string memory b,
    string memory c
) pure returns (string memory) {
    return string(abi.encodePacked(a, b, c));
}

function concat(
    string memory a,
    string memory b,
    string memory c,
    string memory d
) pure returns (string memory) {
    return string(abi.encodePacked(a, b, c, d));
}

function errRange(uint192 price, uint192 error) pure returns (uint192 low, uint192 high) {
    return (FixLib.mul(price, FIX_ONE - error), FixLib.mul(price, FIX_ONE + error, CEIL));
}

function getFirstChar(string memory originString) pure returns (string memory firstChar) {
    bytes memory firstCharByte = new bytes(1);
    firstCharByte[0] = bytes(originString)[0];
    return string(firstCharByte);
}

function strEqual(string memory stringA, string memory stringB) pure returns (bool) {
    return keccak256(bytes(stringA)) == keccak256(bytes(stringB));
}

function bytes32ToString(bytes32 _bytes32) pure returns (string memory) {
    uint8 i = 0;
    while (i < 32 && _bytes32[i] != 0) {
        i++;
    }
    bytes memory bytesArray = new bytes(i);
    for (i = 0; i < 32 && _bytes32[i] != 0; i++) {
        bytesArray[i] = _bytes32[i];
    }
    return string(bytesArray);
}

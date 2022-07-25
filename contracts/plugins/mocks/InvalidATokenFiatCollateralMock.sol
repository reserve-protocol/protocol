// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/ATokenFiatCollateral.sol";

contract InvalidATokenFiatCollateralMock is ATokenFiatCollateral {
    /// @param tradingRange_ {tok} The min and max of the trading range for this asset
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        TradingRange memory tradingRange_,
        uint32 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        ATokenFiatCollateral(
            chainlinkFeed_,
            erc20_,
            rewardERC20_,
            tradingRange_,
            oracleTimeout_,
            targetName_,
            defaultThreshold_,
            delayUntilDefault_
        )
    {}

    /// Invalid claim calldata
    function getClaimCalldata() external pure override returns (address _to, bytes memory _cd) {
        _to = address(0);
        _cd = abi.encodeWithSignature("claimRewardsToSelf(bool)", true);
    }
}

// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/CTokenFiatCollateral.sol";
import "contracts/plugins/assets/OracleLib.sol";

/**
 * @title CTokenBridgedCollateral
 * @notice Collateral plugin for a cToken of a bridged asset. For example:
 *   - cWBTC
 *   - ...
 */
contract CTokenBridgedCollateral is CTokenFiatCollateral {
    using OracleLib for AggregatorV3Interface;

    constructor(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata referenceERC20_,
        IERC20 rewardERC20_,
        address comptrollerAddr_
    )
        CTokenFiatCollateral(
            chainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            targetName_,
            defaultThreshold_,
            delayUntilDefault_,
            referenceERC20_,
            rewardERC20_,
            comptrollerAddr_
        )
    {
        CTokenBridgedCollateral_init();
    }

    // solhint-disable no-empty-blocks
    // solhint-disable-next-line func-name-mixedcase
    function CTokenBridgedCollateral_init() public initializer {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return chainlinkFeed.price();
    }
}

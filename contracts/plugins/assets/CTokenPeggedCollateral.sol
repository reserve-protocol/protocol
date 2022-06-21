// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/CTokenFiatCollateral.sol";

/**
 * @title CTokenPeggedCollateral
 * @notice Collateral plugin for a cToken of a pegged asset. For example:
 *   - cWBTC
 *   - ...
 */
contract CTokenPeggedCollateral is CTokenFiatCollateral {
    using FixLib for uint192;
    using SafeERC20 for IERC20Metadata;

    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    // solhint-disable no-empty-blocks
    constructor(
        IMain main_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata referenceERC20_,
        IERC20 rewardERC20_,
        address comptrollerAddr_
    )
        CTokenFiatCollateral(
            main_,
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            referenceERC20_,
            rewardERC20_,
            comptrollerAddr_
        )
    {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return main.oracle().priceUSD(bytes32(bytes(referenceERC20.symbol())));
    }
}

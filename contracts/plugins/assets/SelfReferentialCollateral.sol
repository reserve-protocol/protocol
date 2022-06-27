// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";

/**
 * @title SelfReferentialCollateral
 * @notice Self-referential collateral is collateral where {target} == {ref} == {tok}
 * Such as:
 *   - WETH
 *   - COMP
 *   - MKR
 *   - ...
 *
 * Self-referential collateral cannot default
 */
contract SelfReferentialCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;

    // solhint-disable-next-line func-name-mixedcase
    function SelfReferentialCollateral_init(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        bytes32 targetName_
    ) external initializer {
        __Asset_init(AggregatorV3Interface(address(0)), erc20_, maxTradeVolume_);
        __Collateral_init(targetName_);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view virtual override returns (uint192) {
        return chainlinkFeed.price();
    }
}

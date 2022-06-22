// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "./Asset.sol";

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
contract SelfReferentialCollateral is ICollateral, Asset, Context {
    using FixLib for uint192;

    // targetName: The canonical name of this collateral's target unit.
    bytes32 public immutable targetName;

    constructor(
        IMain main_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        bytes32 targetName_
    ) Asset(main_, erc20_, maxTradeVolume_) {
        targetName = targetName_;
    }

    // solhint-disable-next-line no-empty-blocks
    function refresh() external virtual {}

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override(Asset, IAsset) returns (uint192) {
        return main.oracle().priceUSD(bytes32(bytes(erc20.symbol())));
    }

    /// @return The collateral's status -- always SOUND!
    function status() public view virtual returns (CollateralStatus) {
        return CollateralStatus.SOUND;
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual override(Asset, IAsset) returns (bool) {
        return true;
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view virtual returns (uint192) {
        return FIX_ONE;
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual returns (uint192) {
        return FIX_ONE;
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view virtual returns (uint192) {
        return main.oracle().priceUSD(bytes32(bytes(erc20.symbol())));
    }
}

// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../interfaces/IAsset.sol";
import "./Asset.sol";

/**
 * @title UnpricedCollateral
 * @notice Collateral plugin for tokens that are missing a price oracle
 *
 * Warning:  This plugin CANNOT be used in an RToken that needs to rebalance
 *           It should only go into immutable RTokens that cannot have their basket changed
 *
 * - tok = X
 * - ref = X
 * - target = X
 * - UoA = USD
 */
contract UnpricedCollateral is ICollateral, VersionedAsset {
    using FixLib for uint192;

    CollateralStatus public constant status = CollateralStatus.SOUND;

    uint192 public constant refPerTok = FIX_ONE;

    uint192 public constant targetPerRef = FIX_ONE;

    uint192 public constant savedPegPrice = 0;

    uint192 public constant maxTradeVolume = 0;

    uint48 public constant lastSave = 0;

    // === Immutables ===

    IERC20Metadata public immutable erc20;

    uint8 public immutable erc20Decimals;

    bytes32 public immutable targetName;

    constructor(IERC20Metadata _erc20, bytes32 _targetName) {
        require(address(_erc20) != address(0), "missing erc20");
        require(_targetName != bytes32(0), "targetName missing");
        erc20 = _erc20;
        erc20Decimals = _erc20.decimals();
        targetName = _targetName;
    }

    // solhint-disable no-empty-blocks

    /// Should not revert
    /// Refresh saved prices
    function refresh() public virtual override {}

    function price() public view virtual override returns (uint192 low, uint192 high) {
        return (0, FIX_MAX);
    }

    /// @return {tok} The balance of the ERC20 in whole tokens
    function bal(address account) external view virtual returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals), FLOOR);
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual returns (bool) {
        return true;
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @custom:delegate-call
    function claimRewards() external virtual {}

    // solhint-enable no-empty-blocks
}

// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "./Collateral.sol";

// Interfaces to contracts from: https://git.io/JX7iJ
interface IStaticAToken is IERC20 {
    function claimRewardsToSelf(bool forceUpdate) external;

    // @return RAY{fiatTok/tok}
    function rate() external view returns (uint256);

    // solhint-disable-next-line func-name-mixedcase
    function ATOKEN() external view returns (AToken);

    function getClaimableRewards(address user) external view returns (uint256);
}

interface AToken {
    // solhint-disable-next-line func-name-mixedcase
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

/// @dev In Aave the number of decimals of the staticAToken is always 18, but the
/// underlying rebasing AToken will have the same number of decimals as its fiatcoin.
contract ATokenCollateralP0 is CollateralP0 {
    using FixLib for Fix;

    // solhint-disable-next-line no-empty-blocks
    constructor(address erc20_, IMain main_) CollateralP0(erc20_, main_) {}

    constructor(
        UoA uoa_,
        IERC20Metadata erc20_,
        IMain main_
    ) CollateralP0(uoa_, erc20_, main_, Oracle.Source.AAVE) {}

    /// @return {underlyingTok/tok} Conversion rate between token and its underlying.
    function _rateToUnderlying() internal view override returns (Fix) {
        uint256 rateInRAYs = IStaticAToken(_erc20).rate(); // {ray underlyingTok/tok}
        return toFixWithShift(rateInRAYs, -27);
    }
}

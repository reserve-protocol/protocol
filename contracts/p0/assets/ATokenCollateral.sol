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

    constructor(
        UoA uoa_,
        IERC20Metadata erc20_,
        IMain main_,
        ICollateral underlying_
    ) CollateralP0(uoa_, erc20_, main_, underlying_.oracle()) {
        underlying = underlying_;
    }

    /// @return {underlyingTok/tok} The rate between the token and fiatcoin
    function fiatcoinRate() public view override returns (Fix) {
        uint256 rateInRAYs = IStaticAToken(address(erc20)).rate(); // {ray underlyingTok/tok}
        return toFixWithShift(rateInRAYs, -27);
    }
}

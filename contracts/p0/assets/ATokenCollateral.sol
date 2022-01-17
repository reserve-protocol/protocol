// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "./LendingCollateral.sol";

// Interfaces to contracts from: https://git.io/JX7iJ
interface IStaticAToken is IERC20Metadata {
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
contract ATokenCollateralP0 is LendingCollateralP0 {
    using SafeERC20 for IERC20Metadata;

    // solhint-disable no-empty-blocks

    constructor(
        IERC20Metadata erc20_,
        IMain main_,
        IOracle oracle_
    ) PeggedCollateralP0(erc20_, main_, oracle_, FIX_ONE) {}

    /// @dev Intended to be used via delegatecall
    function claimAndSweepRewards(ICollateral collateral, IMain main_) external virtual override {
        // TODO: We need to ensure that calling this function directly,
        // without delegatecall, does not allow anyone to extract value.
        // This should already be the case because the Collateral
        // contract itself should never earn rewards.

        IStaticAToken aToken = IStaticAToken(address(collateral.erc20()));
        uint256 amount = aToken.getClaimableRewards(address(this));
        if (amount > 0) {
            aToken.claimRewardsToSelf(true);
            main_.aaveAsset().erc20().safeTransfer(address(main), amount);
        }
    }

    /// @return {underlyingTok/tok} The rate between the token and fiatcoin
    function rateToUnderlying() public view virtual override returns (Fix) {
        uint256 rateInRAYs = IStaticAToken(address(erc20)).rate(); // {ray underlyingTok/tok}
        return toFixWithShift(rateInRAYs, -27);
    }
}

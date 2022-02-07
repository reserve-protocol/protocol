// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/assets/abstract/AaveOracleMixin.sol";
import "contracts/p0/assets/abstract/Collateral.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

// ==== External ====

// External interfaces from: https://git.io/JX7iJ
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

// ==== End External ====

contract ATokenFiatcoinCollateralP0 is AaveOracleMixinP0, CollateralP0 {
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    Fix public prevReferencePrice; // previous rate, {collateral/reference}

    constructor(
        IERC20Metadata erc20_,
        IERC20Metadata referenceERC20_,
        IMain main_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_
    )
        CollateralP0(erc20_, referenceERC20_, main_, bytes32(bytes("USD")))
        AaveOracleMixinP0(comptroller_, aaveLendingPool_)
    {
        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (Fix) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return consultOracle(referenceERC20).mul(refPerTok());
    }

    /// Default checks
    function forceUpdates() public virtual override {
        if (whenDefault <= block.timestamp) {
            return;
        }
        uint256 cached = whenDefault;

        // Check invariants
        Fix p = refPerTok();
        if (p.lt(prevReferencePrice)) {
            whenDefault = block.timestamp;
        } else {
            // If the underlying is showing signs of depegging, default eventually
            whenDefault = isReferenceDepegged()
                ? Math.min(whenDefault, block.timestamp + main.defaultDelay())
                : NEVER;
        }
        prevReferencePrice = p;

        if (whenDefault != cached) {
            emit DefaultStatusChanged(cached, whenDefault, status());
        }
    }

    /// @dev Intended to be used via delegatecall
    function claimAndSweepRewards(ICollateral collateral, IMain main_) external virtual override {
        // Invariant: This function does not perform reads from current context storage

        IStaticAToken aToken = IStaticAToken(address(collateral.erc20()));
        uint256 amount = aToken.getClaimableRewards(address(this));
        if (amount > 0) {
            aToken.claimRewardsToSelf(true);
            main_.aaveAsset().erc20().safeTransfer(address(main_), amount);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (Fix) {
        uint256 rateInRAYs = IStaticAToken(address(erc20)).rate(); // {ray ref/tok}
        return toFixWithShift(rateInRAYs, -27);
    }

    function isReferenceDepegged() private view returns (bool) {
        // {UoA/ref} = {UoA/target} * {target/ref}
        Fix peg = pricePerTarget().mul(targetPerRef());
        Fix delta = peg.mul(main.defaultThreshold());
        Fix p = consultOracle(referenceERC20);
        return p.lt(peg.minus(delta)) || p.gt(peg.plus(delta));
    }
}

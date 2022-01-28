// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Collateral.sol";

// cToken initial exchange rate is 0.02

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    /// @dev From Compound Docs:
    /// The current (up to date) exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
    function exchangeRateCurrent() external returns (uint256);

    /// @dev From Compound Docs: The stored exchange rate, with 18 - 8 + UnderlyingAsset.Decimals.
    function exchangeRateStored() external view returns (uint256);
}

contract CTokenCollateralP0 is CollateralP0 {
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;
    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    Fix public constant COMPOUND_BASE = Fix.wrap(2e16); // 0.02

    Fix public prevReferencePrice; // {ref/tok} previous rate {collateral/reference}

    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        IERC20Metadata referenceERC20_,
        IMain main_,
        IOracle oracle_,
        bytes32 targetName_
    ) CollateralP0(erc20_, referenceERC20_, main_, oracle_, targetName_) {}

    // solhint-enable no-empty-blocks

    /// Update the Compound protocol + default status
    function forceUpdates() public virtual override {
        if (whenDefault <= block.timestamp) {
            return;
        }

        // Update Compound
        ICToken(address(erc20)).exchangeRateCurrent();

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
    }

    /// @dev Intended to be used via delegatecall
    function claimAndSweepRewards(ICollateral collateral, IMain main_) external virtual override {
        // TODO: We need to ensure that calling this function directly,
        // without delegatecall, does not allow anyone to extract value.
        // This should already be the case because the Collateral
        // contract itself should never earn rewards.

        // compound groups all rewards automatically
        // we still need to use `collateral` to avoid storage reads in the delegateCall
        collateral.oracle().comptroller().claimComp(address(this));
        uint256 amount = main_.compAsset().erc20().balanceOf(address(this));
        if (amount > 0) {
            main_.compAsset().erc20().safeTransfer(address(main_), amount);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (Fix) {
        uint256 rate = ICToken(address(erc20)).exchangeRateStored();
        int8 shiftLeft = 8 - int8(referenceERC20.decimals()) - 18;
        Fix rateNow = toFixWithShift(rate, shiftLeft);
        return rateNow.div(COMPOUND_BASE);
    }
}

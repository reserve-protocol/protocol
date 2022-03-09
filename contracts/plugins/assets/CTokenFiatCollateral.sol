// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";
import "contracts/plugins/assets/abstract/Collateral.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

// ==== External Interfaces ====
// See: https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    /// @dev From Compound Docs:
    /// The current (up to date) exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
    function exchangeRateCurrent() external returns (uint256);

    /// @dev From Compound Docs: The stored exchange rate, with 18 - 8 + UnderlyingAsset.Decimals.
    function exchangeRateStored() external view returns (uint256);
}

// ==== End External Interfaces ====

contract CTokenFiatCollateralP0 is CompoundOracleMixinP0, CollateralP0 {
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    // cToken initial exchange rate is 0.02
    Fix public constant COMPOUND_BASE = Fix.wrap(2e16);

    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    Fix public prevReferencePrice; // previous rate, {collateral/reference}
    IERC20 public immutable override rewardERC20;

    constructor(
        IERC20Metadata erc20_,
        Fix maxAuctionSize_,
        Fix defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata referenceERC20_,
        IComptroller comptroller_,
        IERC20 rewardERC20_
    )
        CollateralP0(
            erc20_,
            maxAuctionSize_,
            defaultThreshold_,
            delayUntilDefault_,
            referenceERC20_,
            bytes32(bytes("USD"))
        )
        CompoundOracleMixinP0(comptroller_)
    {
        rewardERC20 = rewardERC20_;
        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual returns (Fix) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return consultOracle(referenceERC20).mul(refPerTok());
    }

    /// Default checks
    function forceUpdates() public virtual override {
        if (whenDefault <= block.timestamp) {
            return;
        }
        uint256 cached = whenDefault;

        // Update the Compound Protocol
        ICToken(address(erc20)).exchangeRateCurrent();

        // Check invariants
        Fix p = refPerTok();
        if (p.lt(prevReferencePrice)) {
            whenDefault = block.timestamp;
        } else {
            // If the underlying is showing signs of depegging, default eventually
            whenDefault = isReferenceDepegged()
                ? Math.min(whenDefault, block.timestamp + delayUntilDefault)
                : NEVER;
        }
        prevReferencePrice = p;

        if (whenDefault != cached) {
            emit DefaultStatusChanged(cached, whenDefault, status());
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (Fix) {
        uint256 rate = ICToken(address(erc20)).exchangeRateStored();
        int8 shiftLeft = 8 - int8(referenceERC20.decimals()) - 18;
        Fix rateNow = toFixWithShift(rate, shiftLeft);
        return rateNow.div(COMPOUND_BASE);
    }

    function isReferenceDepegged() private view returns (bool) {
        // {UoA/ref} = {UoA/target} * {target/ref}
        Fix peg = pricePerTarget().mul(targetPerRef());
        Fix delta = peg.mul(defaultThreshold);
        Fix p = consultOracle(referenceERC20);
        return p.lt(peg.minus(delta)) || p.gt(peg.plus(delta));
    }

    function getClaimCalldata(IERC20) external view returns (address _to, bytes memory _calldata) {
        _to = address(comptroller);
        _calldata = abi.encodeWithSignature("claimComp(address)", msg.sender);
    }
}

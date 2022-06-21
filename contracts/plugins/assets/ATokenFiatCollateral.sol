// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/plugins/assets/FiatCollateral.sol";
import "contracts/interfaces/IMain.sol";
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

contract ATokenFiatCollateral is FiatCollateral {
    using FixLib for uint192;
    using SafeERC20 for IERC20Metadata;

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    IERC20 public override rewardERC20;

    constructor(
        IMain main_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata referenceERC20_,
        IERC20 rewardERC20_
    )
        FiatCollateral(
            main_,
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            referenceERC20_
        )
    {
        rewardERC20 = rewardERC20_;
        prevReferencePrice = refPerTok(); // {collateral/reference}
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return main.oracle().priceUSD(bytes32(bytes(referenceERC20.symbol()))).mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    function refresh() external virtual override {
        if (whenDefault <= block.timestamp) return;

        uint256 oldWhenDefault = whenDefault;

        uint192 referencePrice = refPerTok();
        if (referencePrice.lt(prevReferencePrice)) {
            whenDefault = block.timestamp;
        } else {
            // Check for soft default of underlying reference token
            uint192 p = main.oracle().priceUSD(bytes32(bytes(referenceERC20.symbol())));

            // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
            uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;
            uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

            // If the price is below the default-threshold price, default eventually
            if (p < peg - delta || p > peg + delta) {
                whenDefault = Math.min(block.timestamp + delayUntilDefault, whenDefault);
            } else whenDefault = NEVER;
        }
        prevReferencePrice = referencePrice;

        if (whenDefault != oldWhenDefault) {
            emit DefaultStatusChanged(oldWhenDefault, whenDefault, status());
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 rateInRAYs = IStaticAToken(address(erc20)).rate(); // {ray ref/tok}
        return shiftl_toFix(rateInRAYs, -27);
    }

    /// Get the message needed to call in order to claim rewards for holding this asset.
    /// @return _to The address to send the call to
    /// @return _cd The calldata to send
    function getClaimCalldata() external view override returns (address _to, bytes memory _cd) {
        _to = address(erc20); // this should be a StaticAToken
        _cd = abi.encodeWithSignature("claimRewardsToSelf(bool)", true);
    }
}

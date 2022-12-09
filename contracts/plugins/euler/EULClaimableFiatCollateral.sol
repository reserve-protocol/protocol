// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/euler/IEulerCollateral.sol";

/**
 * @title EULClaimableETokenNonFiatCollateral
 * @notice Collateral plugin for a eToken of fiat collateral, like eUSDC or eUSDT
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 * tok: eDAI, eUSDC and USDT
 * ref: DAI, USDC and USDT
 * target: USD
 */
contract EULClaimableETokenFiatCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    uint192 public prevReferencePrice; 
    uint192 public immutable defaultThreshold;
    int8 public immutable referenceERC20Decimals;

    IEulDistributor public immutable eulDistributor;

    /// @param chainlinkFeed_ Feed units: {target/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_,
        IEulDistributor eulDistributor_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        require(address(eulDistributor_) != address(0), "eulDistributor missing");

        defaultThreshold = defaultThreshold_;
        referenceERC20Decimals = referenceERC20Decimals_;
        eulDistributor = eulDistributor_;

        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
    }


    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        // == Refresh ==
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                // Check for soft default of underlying reference token
                // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
                uint192 peg = targetPerRef();

                // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
                uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (p < peg - delta || p > peg + delta) markStatus(CollateralStatus.IFFY);
                else markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    // = ewstETH / wstETH
    function refPerTok() public view override returns (uint192) {
        uint256 rate = IEToken(address(erc20)).convertBalanceToUnderlying(FIX_ONE_256);
        int8 shiftLeft = referenceERC20Decimals * -1;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// getClaimData() should be in another periphery contract deployed by Rtoken creator. 
    /// This is because state variables in the collateral contract can't be read and used 
    /// via delegatecall() from other Reserve core contracts
    /// EulDistributor is called for the sake of example but it doesnt store data for claiming.
    /// @dev delegatecall
    function claimRewards() external virtual override {
        IERC20 eul = IERC20(eulDistributor.eul());
        uint256 oldBal = eul.balanceOf(address(this));
    
        (uint claimable, bytes32[] memory proof) = eulDistributor.getClaimData(); 

        if (claimable != 0 && proof.length != 0) 
        eulDistributor.claim(address(this), address(eul), claimable, proof, address(0));

        emit RewardsClaimed(eul, eul.balanceOf(address(this)) - oldBal);
    }
}

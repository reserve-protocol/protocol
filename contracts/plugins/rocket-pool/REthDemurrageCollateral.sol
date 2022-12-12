// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/rocket-pool/interfaces/IREthToken.sol";
import "contracts/plugins/rocket-pool/interfaces/IRocketNetworkBalances.sol";
import "contracts/plugins/rocket-pool/interfaces/IRocketStorage.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/rocket-pool/libraries/ABDKMath64x64.sol";

/**
 * @title REthDemurrageCollateral
 * @notice Collateral plugin for rEth - a Demurrage Collateral Plugin.
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 * tok = rETH
 * ref = target = DMR100rETH
 * UoA = USD
 */
contract REthDemurrageCollateral is Collateral {
    using ABDKMath64x64 for uint;
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    int192 public constant oneHundredPercentRate = int192(FIX_ONE);
    uint public lastProcessedTimestamp;
    uint192 public latestRefPerTok; // previous rate, {collateral/reference}
    uint128 public immutable demurrage_rate_per_second; // oneHundredPercentRate = maximum value = 100000000 = 100%
    uint24 public maxDaysWORefresh; 
    int8 public immutable referenceERC20Decimals;
   

    /// @param chainlinkFeed_ Feed units: {UoA/ETH}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_,
        uint128 demurrage_rate_per_second_,
        uint24 maxDaysWORefresh_
        
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
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        referenceERC20Decimals = referenceERC20Decimals_;
        demurrage_rate_per_second = demurrage_rate_per_second_;
        uint nowTimestamp = block.timestamp;
        uint nowMinusArbTimestamp = nowTimestamp - 1640995200; // 1640995200 is the timestamp used by Reserve Protocol on all demurrage collaterals.
        uint subtractor = nowMinusArbTimestamp % (3600 * 24);
        lastProcessedTimestamp = (nowTimestamp - subtractor) ; 
        latestRefPerTok = uint192(oneHundredPercentRate);
        maxDaysWORefresh = maxDaysWORefresh_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ETH} * {ETH/tok} * inflation 

        uint192 chainlinkFeedPrice = chainlinkFeed.price(oracleTimeout);
        uint192 unshiftedStrictPrice = chainlinkFeedPrice * rEthToEth() * refPerTok();
        int8 shiftLeft = - 3 * referenceERC20Decimals;
        return (shiftl_toFix(unshiftedStrictPrice, shiftLeft));

    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < latestRefPerTok) {

            markStatus(CollateralStatus.DISABLED);
        } else{
            try chainlinkFeed.price_(oracleTimeout) returns (uint192) {

                markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {

                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }

            if (referencePrice > latestRefPerTok){

                latestRefPerTok = referencePrice;
                lastProcessedTimestamp = block.timestamp;
            }
        } 

        

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
        // No interactions beyond the initial refresher
    }


    /// @return {ref/tok} Returns inflationary valuation of collateral unit.
    function refPerTok() public view override returns (uint192) {
        
        uint nowMinusLastTimestamp = block.timestamp - lastProcessedTimestamp;
        uint subtractFactor = nowMinusLastTimestamp % (3600 * 24); 
        uint daysUncounted = (nowMinusLastTimestamp - subtractFactor) / (3600 * 24) ; // subtraction to get a timestamp that represents a whole hour
     
        /// @dev requires contract to be refreshed at least every maxDaysWORefresh -1 days.
        /// This value is defined at the constructor.
        /// This protects from the risk of arithmetic overflow through doing exponential operations.
        if(daysUncounted < maxDaysWORefresh){
            uint latestRefPerTok_ = latestRefPerTok;
            while(daysUncounted > 0){

                latestRefPerTok_ = latestRefPerTok_ * (FIX_ONE + 1e6 *(demurrage_rate_per_second * 3600 * 24)) /  FIX_ONE;
                daysUncounted -= 1;
            }
        return uint192(latestRefPerTok_);
        } else{
            // defaults the collateral

            return(latestRefPerTok - 1);
        }

        
    }


     /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        // {ref} == {target}
        // {UoA/target} = {UoA/ETH} * {ETH/tok} / {ref/tok} = {UoA/ETH} * {ETH/tok} * {tok/ref}
        return (strictPrice() * FIX_ONE) / refPerTok();
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {
        emit RewardsClaimed(IERC20(address(0)), 0);
    }

    /// @return {ref/ETH} Quantity of whole ETH units per whole collateral tokens
    /// @dev from  rocket-pool's documentation:
    // Get the current ETH : rETH exchange rate
    // Returns the amount of ETH backing 1 rETH
    function rEthToEth() public view returns (uint192) {

        IREthToken rEth = IREthToken(address(erc20));
        uint256 rate = rEth.getEthValue(FIX_ONE);
        return uint192(rate);
        
    }

}

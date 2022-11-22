// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/IStakedToken.sol";
import "hardhat/console.sol";

/**
 * @title CbEthCollateral
 * @notice Collateral plugin for a cbETH Token.
 * {tok} = cbETH
 * {ref} = ETH
 * {target} = {ref}  = ETH
 * {UoA} = USD
 * @notice implements Abstract collateral 
 */
contract CbEthCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // All cbEth Tokens have 18 decimals, same as ETH
    uint192 public prevReferencePrice; // previous rate, {tok/ref}
    // IStakedController public immutable stakedController;

    event ReceivedReward(address indexed sender, uint256 amount);

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_
        // IStakedController stakedController_
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
        //require(address(stakedController_) != address(0), "stakedController missing");
        prevReferencePrice = refPerTok();
        // stakedController = stakedController_;
        //IERC20 staked = IERC20(stakedController.getStakedAddress());
        //staked.approve(address(stakedController), maxTradeVolume_);
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
            try chainlinkFeed.price_(oracleTimeout) returns (uint192) {
                markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        // update ref price 
        prevReferencePrice = referencePrice;
        // update status 
        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
        // No interactions beyond the initial refresher
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        console.log("cbEth addr", address(erc20));
        uint256 rate = IStakedToken(address(erc20)).exchangeRate();
        console.log("rate is " , rate);
        return uint192(rate);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }

    /// Claim rewards earned by converting cbEth to ETH
    /// should recieve ETH = cbEth * exRate / 10**18
    /// unavailable until the Shanghai upgrade allows for staking withdrawals
    /// CbEthControllerMock will be used to test when available
    /// @dev delegatecall
    /// @notice https://www.coinbase.com/cbeth/whitepaper
    function claimRewards() external override {
        //IERC20 staked = IERC20(stakedController.getStakedAddress());
        IERC20 staked = IERC20(address(erc20));
        console.log("cbEth addr", address(staked));
        uint256 bal = staked.balanceOf(address(this)); // cbETH balance
        //stakedController.claimStaked(address(this), bal);
        console.log("bal " , bal);
        uint192 reward = uint192(bal).mul(refPerTok());
        console.log("refpertok ", refPerTok());
        emit RewardsClaimed(staked, reward);
    }

    /// @custom:interaction RCEI
    function approve( address spender, uint256 amount) external {
        IERC20 staked = IERC20(address(erc20));
        staked.approve(spender, amount);
    }

    receive() external payable {
        //require(msg.sender == address(stakedController), "Receive ETH only from staked controller");
        emit ReceivedReward(msg.sender, msg.value);
    }

    fallback() external {}

}

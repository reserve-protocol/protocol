// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IVault.sol";
import "./interfaces/ILiquidityGaugeFactory.sol";
import "./interfaces/IBalancerMinter.sol";
import "./interfaces/BPool.sol";

import "../FiatCollateral.sol";

struct BalancerCollateralConfig {
    // bitmap of which tokens are fiat:
    // e.g if the bit representation of tokenIsFiat is:
    // 00...001 -> token0 is pegged to UoA
    // 00...010 -> token1 is pegged to UoA
    // 00...011 -> both of them are pegged to UoA;
    uint256 tokenIsFiat;
    bytes32 poolId; // balancer pool id
    AggregatorV3Interface token0ChainlinkFeed; // token0 feed
    AggregatorV3Interface token1ChainlinkFeed; // token0 feed
    ILiquidityGaugeFactory gaugeFactory; // address of balancer's gauge factory
    IBalancerMinter balancerMinter; // bal minter address
}

/**
 * @title BalancerLPCollateral
 * Parent plugin for most Balancer LP Tokens
 *
 * For: {tok} != {ref}, {ref} != {target}, {target} == {UoA}
 * Can be easily extended by (optionally) re-implementing:
 *   - tryPrice()
 *   - targetPerRef()
 *   - claimRewards()
 */
contract BalancerLPCollateral is FiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // Default Status:
    // _whenDefault == NEVER: no risk of default (initial value)
    // _whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving _whenDefault == NEVER.
    // _whenDefault <= block.timestamp: default has already happened (permanently)

    bytes32 poolId;

    AggregatorV3Interface public immutable token0ChainlinkFeed; 
    AggregatorV3Interface public immutable token1ChainlinkFeed; 
    IVault balancerVault;
    BPool balancerPool;
    ILiquidityGaugeFactory gaugeFactory;
    address gauge;
    IBalancerMinter balancerMinter;
    IERC20 balancerToken;

    // bitmap of which tokens are fiat:
    // e.g if the bit representation of tokenIsFiat is:
    // 00...001 -> token0 is pegged to UoA
    // 00...010 -> token1 is pegged to UoA
    // 00...011 -> both of them are pegged to UoA;
    uint256 tokenIsFiat;
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}


    /// @dev config Unused members: chainlinkFeed, oracleError 
    /// @dev config.erc20 should be a BPool
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(CollateralConfig memory config, BalancerCollateralConfig memory balConfig)
        FiatCollateral(config)
    {
        require(address(balConfig.token1ChainlinkFeed) != address(0), "missing token1 chainlink feed");
        require(address(balConfig.token0ChainlinkFeed) != address(0), "missing token0 chainlink feed");
        require(address(config.erc20) != address(0), "missing balancer pool");
        // scope out var to prevent stack depth error
        {
            require(address(config.erc20) != address(0), "missing balancer pool");
            BPool balancerPool_ = BPool(address(config.erc20)); // TODO: is this needed? Isn't it handled by the base class's constructor?
            IVault balancerVault_ = balancerPool_.getVault();
            require(address(balancerVault_) != address(0), "missing balancer vault");
            balancerPool = balancerPool_;
            balancerVault = balancerVault_;
        }
        {
            require(address(balConfig.gaugeFactory) != address(0), "missing gaugeFactory");
            address gauge_ = balConfig.gaugeFactory.getPoolGauge(address(erc20));
            require(gauge_ != address(0), "missing gauge");
            gauge = gauge_;
        }
        require(address(balConfig.balancerMinter) != address(0), "missing balancer minter");
        balancerMinter = balConfig.balancerMinter;
        {
            IERC20 balancerToken_ = balancerMinter.getBalancerToken();
            require(address(balancerToken_) != address(0), "missing balancer token");
            balancerToken = balancerToken_;
        }
        require(balConfig.tokenIsFiat <= 3 && balConfig.tokenIsFiat >= 0, "invalid tokenIsFiat bitmap");
        require(config.targetName != bytes32(0), "targetName missing");
        if (config.defaultThreshold > 0) {
            require(config.delayUntilDefault > 0, "delayUntilDefault zero");
        }
        require(config.delayUntilDefault <= 1209600, "delayUntilDefault too long");

        // {target/ref} = {target/ref} * {1}
        tokenIsFiat = balConfig.tokenIsFiat;
        poolId = balConfig.poolId;
        prevReferencePrice = refPerTok();
        token0ChainlinkFeed = balConfig.token0ChainlinkFeed;
        token1ChainlinkFeed = balConfig.token1ChainlinkFeed;
    }

    function isTokenFiat(uint256 indexFromRight) public view returns (bool) {
        uint256 bitAtIndex = tokenIsFiat & (1 << indexFromRight);
        return bitAtIndex > 0;
    }

    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 tokenPrice
        )
    {
        // {target/ref} = {UoA/ref} / {UoA/target} (1)
        uint192 token0Price = token0ChainlinkFeed.price(oracleTimeout);
        uint192 token1Price = token1ChainlinkFeed.price(oracleTimeout);
        (,uint256[] memory tokenSupplies,) = balancerVault.getPoolTokens(poolId);
        uint256 token0Supply = tokenSupplies[0];
        uint256 token1Supply = tokenSupplies[1];

        uint192 priceTotal = (token0Price.muluDivu(token0Supply, 1 ether)) + (token1Price.muluDivu(token1Supply, 1 ether));
        tokenPrice = priceTotal.muluDivu(1 ether, balancerPool.totalSupply());

        // {target/ref} = {target/ref} * {1}
        uint192 err = tokenPrice.mul(oracleError, CEIL);

        low = tokenPrice - err;
        high = tokenPrice + err;
        // assert(low <= high); obviously true just by inspection
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// @dev May need to override: limited to handling collateral with refPerTok() = 1
    function refresh() public virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // check for hard default
        uint192 referencePrice = refPerTok();

        // Check for soft default + save lotPrice
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            try this.tryPrice() returns (uint192 low, uint192 high, uint192 tokenPrice) {
                uint192 p0 = token0ChainlinkFeed.price(oracleTimeout);
                uint192 p1 = token1ChainlinkFeed.price(oracleTimeout);
                // {UoA/tok}, {UoA/tok}, {target/ref}
                // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

                // Save prices if priced
                if (high < FIX_MAX) {
                    savedLowPrice = low;
                    savedHighPrice = high;
                    lastSave = uint48(block.timestamp);
                } else {
                    // must be unpriced
                    assert(low == 0);
                }

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (p0 > 0 && p1 > 0 && tokenPrice > 0) {
                    _checkPriceDeviation(p0, p1);
                } else {
                    markStatus(CollateralStatus.IFFY);
                }

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

    function _checkPriceDeviation(uint192 p0, uint192 p1) internal {
        // checks peg for token0 to UoA
        if(isTokenFiat(0)){

            if (p0 < pegBottom || p0 > pegTop) {
                markStatus(CollateralStatus.IFFY);
            }
        }

        // checks peg for token1 to UoA
        if(isTokenFiat(1)){
            if (p1 < pegBottom || p1 > pegTop) {
                markStatus(CollateralStatus.IFFY);
            }
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view virtual override returns (uint192) {
        (,uint256[] memory tokenSupplies,) = balancerVault.getPoolTokens(poolId);
        uint256 token0Supply = tokenSupplies[0];
        uint256 token1Supply = tokenSupplies[1];

        uint192 rate = divuu(Math.sqrt(token0Supply * token1Supply), balancerPool.totalSupply());
        return rate;
    }

    // Claim balancer token rewards (this cannot be tested - see ./README.md)
    /// @dev Use delegatecall
    function claimRewards() external override(Asset, IRewardable) {
        uint256 balOldBal = balancerToken.balanceOf(address(this));
        balancerMinter.mint_for(gauge, address(this));
        emit RewardsClaimed(balancerToken, balancerToken.balanceOf(address(this)) - balOldBal);
    }
}

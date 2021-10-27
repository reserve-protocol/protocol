// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IAsset.sol";
import "./IAssetManager.sol";
import "./IDefaultMonitor.sol";
import "./IFurnace.sol";
import "./IMain.sol";
import "./IRToken.sol";
import "./IStakingPool.sol";
import "./IVault.sol";

enum State { 
    CALM, 
    DOUBT, 
    MIGRATION, 
    PRECAUTIONARY 
}

struct Config {
    // Time (seconds)
    uint256 rewardStart; // the timestamp of the very first weekly reward handout
    uint256 rewardPeriod; // the duration of time between reward events
    uint256 auctionPeriod; // the length of an auction
    uint256 stakingWithdrawalDelay; // the "thawing time" of staked RSR before withdrawal
    uint256 defaultDelay; // how long to wait until switching vaults after detecting default
    // Percentage values (relative to SCALE)
    uint256 maxTradeSlippage; // the maximum amount of slippage in percentage terms we will accept in a trade
    uint256 auctionClearingTolerance; // the maximum % difference between auction clearing price and oracle data allowed.
    uint256 maxAuctionSize; // the size of an auction, as a fraction of RToken supply
    uint256 minAuctionSize; // the size of an auction, as a fraction of RToken supply
    uint256 migrationChunk; // how much backing to migrate at a time, as a fraction of RToken supply
    uint256 issuanceRate; // the number of RToken to issue per block, as a fraction of RToken supply
    uint256 defaultThreshold; // the percent deviation required before a token is marked as in-default
    uint256 f; // The Revenue Factor: the fraction of revenue that goes to stakers
    // TODO: Revenue Distribution Map

    // Sample values
    //
    // rewardStart = timestamp of first weekly handout
    // rewardPeriod = 604800 (1 week)
    // auctionPeriod = 1800 (30 minutes)
    // stakingWithdrawalDelay = 1209600 (2 weeks)
    // defaultDelay = 86400 (24 hours)
    // maxTradeSlippage = 5e16 (5%)
    // auctionClearingTolerance = 1e17 (10%)
    // maxAuctionSize = 1e16 (1%)
    // minAuctionSize = 1e15 (0.1%)
    // migrationChunk = 2e17 (20%)
    // issuanceRate = 25e13 (0.025% per block, or ~0.1% per minute)
    // defaultThreshold = 5e16 (5% deviation)
    // f = 6e17 (60% to stakers)
}

interface IMain {
    function issue(uint256 amount) external;

    function redeem(uint256 amount) external;

    function poke() external;

    function noticeDefault() external;

    function paused() external view returns (bool);

    function quoteIssue(uint256 amount) external view returns (uint256[] memory);

    function quoteRedeem(uint256 amount) external view returns (uint256[] memory);

    function rsr() external view returns (IERC20);

    function rToken() external view returns (IRToken);

    function furnace() external view returns (IFurnace);

    function staking() external view returns (IStakingPool);

    function assetManager() external view returns (IAssetManager);

    function defaultMonitor() external view returns (IDefaultMonitor);

    // Governance Params

    function rewardStart() external view returns (uint256);

    function rewardPeriod() external view returns (uint256);

    function auctionPeriod() external view returns (uint256);
    
    function stakingWithdrawalDelay() external view returns (uint256);

    function defaultDelay() external view returns (uint256);
    
    function maxTradeSlippage() external view returns (uint256);
    
    function auctionClearingTolerance() external view returns (uint256);
    
    function maxAuctionSize() external view returns (uint256);
    
    function minAuctionSize() external view returns (uint256);
    
    function migrationChunk() external view returns (uint256);
    
    function issuanceRate() external view returns (uint256);
    
    function defaultThreshold() external view returns (uint256);
    
    function f() external view returns (uint256);
    
}

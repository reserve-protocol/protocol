// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./IComponent.sol";

error MissingPriceFeed(bytes32);
error StaleChainlinkPrice(bytes32);
error NegativeChainlinkPrice(bytes32);
error PriceOutsideRange(bytes32);

/**
 * @title IOracle
 * @notice The Oracle is typically used by some subset of collateral. When used, it is in place of
 *   other oracle abstractions (such as those provided by Compound/Aave) that may do too much or
 *    too little, from our system's perspective.
 */
interface IOracle is IComponent {
    event ChainlinkFeedSet(bytes32 indexed symbolBytes, AggregatorV3Interface indexed feed);

    // Initialization
    function init(IMain main_, AggregatorV3Interface rsrPriceFeed_) external;

    /// @param symbolBytes e.g. bytes32(bytes("ETH"))
    /// @return {USD/tok}
    function priceUSD(bytes32 symbolBytes) external view returns (uint192);

    /// @param symbolBytes e.g. bytes32(bytes("ETH"))
    /// @return {EUR/tok}
    function priceEUR(bytes32 symbolBytes) external view returns (uint192);
}

interface TestIOracle is IOracle {
    function chainlink(bytes32 symbolBytes) external view returns (AggregatorV3Interface);

    /// @param symbolBytes e.g. bytes32(bytes("ETH"))
    function setChainlinkFeed(bytes32 symbolBytes, AggregatorV3Interface chainlinkFeed) external;
}

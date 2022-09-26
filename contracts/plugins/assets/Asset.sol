// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/interfaces/IAsset.sol";
import "./OracleLib.sol";

contract Asset is IAsset {
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable chainlinkFeed;

    IERC20Metadata public immutable erc20;

    IERC20 public immutable override rewardERC20;

    uint8 public immutable erc20Decimals;

    uint192 public immutable override maxTradeVolume; // {UoA}

    uint192 public immutable fallbackPrice; // {UoA}

    uint48 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid

    /// @param chainlinkFeed_ Feed units: {UoA/tok}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_
    ) {
        require(fallbackPrice_ > 0, "fallback price zero");
        require(address(chainlinkFeed_) != address(0), "missing chainlink feed");
        require(address(erc20_) != address(0), "missing erc20");
        require(maxTradeVolume_ > 0, "invalid max trade volume");
        require(oracleTimeout_ > 0, "oracleTimeout zero");
        fallbackPrice = fallbackPrice_;
        chainlinkFeed = chainlinkFeed_;
        erc20 = erc20_;
        erc20Decimals = erc20.decimals();
        rewardERC20 = rewardERC20_;
        maxTradeVolume = maxTradeVolume_;
        oracleTimeout = oracleTimeout_;
    }

    /// @return {UoA/tok} The current oracle price of 1 whole token in the UoA, can revert
    function price() public view virtual returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }

    /// @return {UoA/tok} The current price(), or if it's reverting, a fallback price
    function priceWithFailover() public view virtual returns (uint192) {
        try this.price() returns (uint192 p) {
            return (p > 0) ? p : fallbackPrice;
        } catch {
            return fallbackPrice;
        }
    }

    /// @return {tok} The balance of the ERC20 in whole tokens
    function bal(address account) external view returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual returns (bool) {
        return false;
    }

    // solhint-disable no-empty-blocks

    /// (address, calldata) to call in order to claim rewards for holding this asset
    /// @dev The default impl returns zero values, implying that no reward function exists.
    function getClaimCalldata() external view virtual returns (address _to, bytes memory _cd) {}

    // solhint-enable no-empty-blocks
}

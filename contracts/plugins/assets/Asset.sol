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

    uint192 public immutable maxTradeVolume; // {UoA}

    uint32 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid

    /// @param maxTradeVolume_ {UoA} The max amount of value to trade in an indivudual trade
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        uint192 maxTradeVolume_,
        uint32 oracleTimeout_
    ) {
        require(address(chainlinkFeed_) != address(0), "missing chainlink feed");
        require(address(erc20_) != address(0), "missing erc20");
        require(maxTradeVolume_ > 0, "maxTradeVolume zero");
        require(oracleTimeout_ > 0, "oracleTimeout zero");
        chainlinkFeed = chainlinkFeed_;
        erc20 = erc20_;
        rewardERC20 = rewardERC20_;
        maxTradeVolume = maxTradeVolume_;
        oracleTimeout = oracleTimeout_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }

    /// @return {tok} The balance of the ERC20 in whole tokens
    function bal(address account) external view returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20.decimals()));
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual returns (bool) {
        return false;
    }

    /// (address, calldata) to call in order to claim rewards for holding this asset
    /// @dev The default impl returns zero values, implying that no reward function exists.
    // solhint-disable-next-line no-empty-blocks
    function getClaimCalldata() external view virtual returns (address _to, bytes memory _cd) {}
}

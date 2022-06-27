// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "contracts/interfaces/IAsset.sol";
import "./OracleLib.sol";

contract Asset is IAsset, Initializable {
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public chainlinkFeed;

    IERC20Metadata public erc20;

    uint192 public maxTradeVolume; // {UoA}

    // solhint-disable-next-line func-name-mixedcase
    function Asset_init(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_
    ) external initializer {
        __Asset_init(chainlinkFeed_, erc20_, maxTradeVolume_);
    }

    // solhint-disable-next-line func-name-mixedcase
    function __Asset_init(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_
    ) internal onlyInitializing {
        chainlinkFeed = chainlinkFeed_;
        erc20 = erc20_;
        maxTradeVolume = maxTradeVolume_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual returns (uint192) {
        return chainlinkFeed.price();
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

    /// The IERC20 token address that this Asset's rewards are paid in.
    /// @dev The default impl returns zero values, implying that no reward function exists.
    // solhint-disable-next-line no-empty-blocks
    function rewardERC20() external view virtual returns (IERC20 reward) {}
}

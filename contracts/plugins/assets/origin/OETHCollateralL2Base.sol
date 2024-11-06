// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../ERC4626FiatCollateral.sol";
import "../OracleLib.sol";

interface IWSuperOETHb {
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event GovernorshipTransferred(address indexed previousGovernor, address indexed newGovernor);
    event PendingGovernorshipTransfer(
        address indexed previousGovernor,
        address indexed newGovernor
    );
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Withdraw(
        address indexed caller,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );

    function allowance(address owner, address spender) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function asset() external view returns (address);

    function balanceOf(address account) external view returns (uint256);

    function claimGovernance() external;

    function convertToAssets(uint256 shares) external view returns (uint256 assets);

    function convertToShares(uint256 assets) external view returns (uint256 shares);

    function decimals() external view returns (uint8);

    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool);

    function deposit(uint256 assets, address receiver) external returns (uint256);

    function governor() external view returns (address);

    function increaseAllowance(address spender, uint256 addedValue) external returns (bool);

    function initialize() external;

    function isGovernor() external view returns (bool);

    function maxDeposit(address) external view returns (uint256);

    function maxMint(address) external view returns (uint256);

    function maxRedeem(address owner) external view returns (uint256);

    function maxWithdraw(address owner) external view returns (uint256);

    function mint(uint256 shares, address receiver) external returns (uint256);

    function name() external view returns (string memory);

    function previewDeposit(uint256 assets) external view returns (uint256);

    function previewMint(uint256 shares) external view returns (uint256);

    function previewRedeem(uint256 shares) external view returns (uint256);

    function previewWithdraw(uint256 assets) external view returns (uint256);

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256);

    function symbol() external view returns (string memory);

    function totalAssets() external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function transfer(address recipient, uint256 amount) external returns (bool);

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);

    function transferGovernance(address _newGovernor) external;

    function transferToken(address asset_, uint256 amount_) external;

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external returns (uint256);
}

interface IMorphoChainlinkOracleV2 {
    function price() external view returns (uint256);
}

/**
 * @title Origin Staked ETH Collateral for Base L2
 * @notice Collateral plugin for Origin OETH,
 * tok = wsuperOETHb  (wrapped superOETHb)
 * ref = superOETHb (pegged to ETH 1:1)
 * tar = ETH
 * UoA = USD
 */
contract OETHCollateralL2Base is ERC4626FiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IMorphoChainlinkOracleV2 public immutable targetPerTokChainlinkFeed; // {tar/token}

    AggregatorV3Interface public immutable uoaPerTargetChainlinkFeed; // {UoA/tar}
    uint48 public immutable uoaPerTargetChainlinkTimeout; // {s}

    /// @param config.chainlinkFeed - ignored
    /// @param config.oracleTimeout - ignored
    /// @param config.oracleError {1} Should be the oracle error for UoA/tok
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        IMorphoChainlinkOracleV2 _targetPerTokChainlinkFeed,
        AggregatorV3Interface _uoaPerTargetChainlinkFeed,
        uint48 _uoaPerTargetChainlinkTimeout
    ) ERC4626FiatCollateral(config, revenueHiding) {
        require(config.defaultThreshold != 0, "defaultThreshold zero");

        require(address(_targetPerTokChainlinkFeed) != address(0), "targetPerTokFeed missing");
        require(address(_uoaPerTargetChainlinkFeed) != address(0), "uoaPerTargetFeed missing");

        targetPerTokChainlinkFeed = _targetPerTokChainlinkFeed;

        uoaPerTargetChainlinkFeed = _uoaPerTargetChainlinkFeed;
        uoaPerTargetChainlinkTimeout = _uoaPerTargetChainlinkTimeout;

        maxOracleTimeout = uint48(Math.max(maxOracleTimeout, _uoaPerTargetChainlinkTimeout));
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // {tar/tok}
        // {ETH/wsuperOETHb}
        uint192 targetPerTok = _safeWrap(targetPerTokChainlinkFeed.price()) / 1e18;

        // {UoA/tar}
        // {USD/ETH}
        uint192 uoaPerTar = uoaPerTargetChainlinkFeed.price(uoaPerTargetChainlinkTimeout);

        // {UoA/tok} = {UoA/tar} * {tar/tok}
        // USD/wsuperOETHb = USD/ETH * ETH/wsuperOETHb
        uint192 p = uoaPerTar.mul(targetPerTok);
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection

        // {tar/ref} = {tar/tok} / {ref/tok} Get current market peg
        // ETH/superOETHb = ETH/wsuperOETHb / superOETHb/wsuperOETHb
        pegPrice = targetPerTok.div(underlyingRefPerTok());
    }
}

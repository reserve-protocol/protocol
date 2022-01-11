// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "contracts/p0/assets/Asset.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title CollateralP0
 * @notice A vanilla asset such as a fiatcoin, to be extended by derivative assets.
 */
contract CollateralP0 is ICollateral, AssetP0, Context {
    using FixLib for Fix;
    using Oracle for Oracle.Info;

    // underlying == address(0): The collateral is leaf collateral; it has no underlying
    // underlying != address(0): The collateral is derivative collateral; it has underlying collateral
    ICollateral public underlying;

    // Default Status:
    // whenDefault == NEVER: no risk of default (initial value)
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 internal whenDefault = NEVER;
    uint256 internal prevBlock; // Last block when _updateDefaultStatus() was called
    Fix internal prevRate; // Last rate when _updateDefaultStatus() was called

    // solhint-disable-next-list no-empty-blocks
    constructor(
        UoA uoa_,
        IERC20Metadata erc20_,
        IMain main_,
        Oracle.Source oracleSource_
    ) AssetP0(uoa_, erc20_, main_, oracleSource_) {}

    /// Sets `whenDefault`, `prevBlock`, and `prevRate` idempotently
    function forceUpdates() public virtual override {
        _updateDefaultStatus();
    }

    function _updateDefaultStatus() internal {
        if (whenDefault <= block.timestamp || block.number <= prevBlock) {
            // Nothing will change if either we're already fully defaulted
            // or if we've already updated default status this block.
            return;
        }

        // If the redemption rate has fallen, default immediately
        Fix newRate = fiatcoinRate();
        if (newRate.lt(prevRate)) {
            whenDefault = block.timestamp;
        }

        // If the underlying fiatcoin price is below the default-threshold price, default eventually
        if (whenDefault > block.timestamp) {
            Fix p = fiatcoinPrice(); // {attoUSD/fiatTok}
            whenDefault = p.lte(_defaultThreshold())
                ? Math.min(whenDefault, block.timestamp + main.defaultDelay())
                : NEVER;
        }

        // Cache any lesser updates
        prevRate = newRate;
        prevBlock = block.number;
    }

    /// Disable the collateral directly
    function disable() external override {
        require(_msgSender() == address(main), "main only");
        if (whenDefault > block.timestamp) {
            whenDefault = block.timestamp;
        }
    }

    /// @return The asset's default status
    function status() public view returns (CollateralStatus) {
        if (whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (whenDefault <= block.timestamp) {
            return CollateralStatus.DISABLED;
        } else {
            return CollateralStatus.IFFY;
        }
    }

    /// @return {attoUSD/qTok} The atto price of 1 qToken in the given unit of account
    function price() public view virtual override(AssetP0, IAsset) returns (Fix) {
        if (address(underlying) == address(0)) {
            return AssetP0.price();
        }

        return underlying.price().mul(fiatcoinRate());
    }

    /// @return {attoUSD/tok} The atto price of 1 whole fiatcoin in its own unit of account
    function fiatcoinPrice() public view virtual returns (Fix) {
        if (address(underlying) == address(0)) {
            return main.oracle(uoa).consult(oracleSource, erc20);
        }

        return underlying.fiatcoinPrice();
    }

    /// @return {underlyingTok/tok} The rate between the token and fiatcoin
    function fiatcoinRate() public view virtual override returns (Fix) {
        return FIX_ONE;
    }

    /// @return The ERC20 contract of the (maybe underlying) fiatcoin
    function underlyingERC20() public view override returns (IERC20Metadata) {
        if (address(underlying) == address(0)) {
            return erc20;
        }

        return underlying.underlyingERC20();
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() public pure override(AssetP0, IAsset) returns (bool) {
        return true;
    }

    /// @return {attoUSD/fiatTok} The price at which a fiatcoin is said to be defaulting
    function _defaultThreshold() private view returns (Fix) {
        IAsset[] memory allAssets = main.allAssets();
        uint256 numFiatcoins;
        ICollateral[] memory collateral = new ICollateral[](allAssets.length);
        for (uint256 i = 0; i < allAssets.length; i++) {
            ICollateral c = ICollateral(address(allAssets[i]));
            if (
                allAssets[i].uoa() == uoa &&
                allAssets[i].isCollateral() &&
                c.underlyingERC20() == c.erc20()
            ) {
                collateral[numFiatcoins] = c;
                numFiatcoins++;
            }
        }

        // Collect prices
        Fix[] memory prices = new Fix[](numFiatcoins);
        for (uint256 i = 0; i < numFiatcoins; i++) {
            prices[i] = collateral[i].price();
        }

        // Sort
        for (uint256 i = 0; i < prices.length - 1; i++) {
            uint256 min = i;
            for (uint256 j = i; j < prices.length; j++) {
                if (prices[j].lt(prices[min])) {
                    min = j;
                }
            }
            if (min != i) {
                Fix tmp = prices[i];
                prices[i] = prices[min];
                prices[min] = tmp;
            }
        }

        // Take the median
        Fix median;
        if (prices.length % 2 == 0) {
            median = prices[prices.length / 2 - 1].plus(prices[prices.length / 2]).divu(2);
        } else {
            median = prices[prices.length / 2];
        }

        // median - (median * defaultThreshold)
        return median.minus(median.mul(main.defaultThreshold()));
    }
}

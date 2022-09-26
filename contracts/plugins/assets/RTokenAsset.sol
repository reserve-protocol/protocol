// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/Asset.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IRToken.sol";

contract RTokenAsset is IAsset {
    using OracleLib for AggregatorV3Interface;

    IERC20Metadata public immutable erc20;

    IERC20 public immutable rewardERC20;

    uint8 public immutable erc20Decimals;

    uint192 public immutable override maxTradeVolume; // {UoA}

    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    constructor(IRToken erc20_, uint192 maxTradeVolume_) {
        require(address(erc20_) != address(0), "missing erc20");
        require(maxTradeVolume_ > 0, "invalid max trade volume");
        erc20 = IERC20Metadata(address(erc20_));
        erc20Decimals = erc20_.decimals();
        rewardERC20 = IERC20(address(0));
        maxTradeVolume = maxTradeVolume_;
    }

    /// @return p {UoA/tok} The redemption price of the RToken
    function price() public view virtual returns (uint192 p) {
        return _price(false);
    }

    /// @return p {UoA/tok} The current price(), or if it's reverting, a fallback price
    function priceWithFailover() public view virtual returns (uint192 p) {
        // solhint-disable no-empty-blocks
        try this.price() returns (uint192 price_) {
            p = price_;
        } catch {}
        // solhint-enable no-empty-blocks

        if (p == 0) {
            p = _price(true);
        }
    }

    /// @return p {UoA/tok} The redemption price of the RToken, with or without failovers
    function _price(bool withFailover) private view returns (uint192 p) {
        IMain main = IRToken(address(erc20)).main();
        IAssetRegistry assetRegistry = main.assetRegistry();
        address backingMgr = address(main.backingManager());
        uint256 totalSupply = IRToken(address(erc20)).totalSupply();
        uint256 basketsNeeded = IRToken(address(erc20)).basketsNeeded();

        require(totalSupply > 0, "no supply");

        // downcast is safe: basketsNeeded is <= 1e39
        // D18{BU} = D18{BU} * D18{rTok} / D18{rTok}
        uint192 amtBUs = uint192((basketsNeeded * FIX_ONE_256) / totalSupply);

        (address[] memory erc20s, uint256[] memory quantities) = main.basketHandler().quote(
            amtBUs,
            FLOOR
        );

        uint256 erc20length = erc20s.length;

        // Bound each withdrawal by the prorata share, in case we're currently under-capitalized
        for (uint256 i = 0; i < erc20length; ++i) {
            IAsset asset = assetRegistry.toAsset(IERC20(erc20s[i]));

            // TODO consider how to treat case of RToken that has just swapped basket _fully_
            // if we respect the prorated logic, then the price is zero

            // {qTok} =  {qRTok} * {qTok} / {qRTok}
            uint256 prorated = (FIX_ONE_256 * IERC20(erc20s[i]).balanceOf(backingMgr)) /
                (totalSupply);

            if (prorated < quantities[i]) quantities[i] = prorated;

            // D18{tok} = D18 * {qTok} / {qTok/tok}
            uint192 q = shiftl_toFix(quantities[i], -int8(IERC20Metadata(erc20s[i]).decimals()));

            // downcast is safe: total attoUoA from any single asset is well under 1e47
            // D18{UoA} = D18{UoA} + (D18{UoA/tok} * D18{tok} / D18
            p += uint192(
                (withFailover ? asset.priceWithFailover() : asset.price() * uint256(q)) / FIX_ONE
            );
        }
    }

    /// @return {tok} The balance of the ERC20 in whole tokens
    function bal(address account) external view returns (uint192) {
        // The RToken has 18 decimals, so there's no reason to waste gas here doing a shiftl_toFix
        // return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
        return _safeWrap(erc20.balanceOf(account));
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

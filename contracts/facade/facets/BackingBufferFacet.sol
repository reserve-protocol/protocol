// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IAssetRegistry.sol";
import "../../interfaces/IBackingManager.sol";
import "../../interfaces/IBasketHandler.sol";
import "../../interfaces/IRToken.sol";
import "../../libraries/Fixed.sol";

interface OldBasketHandler is IBasketHandler {
    function quote(uint192 amount, RoundingMode rounding)
        external
        view
        returns (address[] memory erc20s, uint256[] memory quantities);
}

/**
 * @title BackingBufferFacet
 * @notice Single-function facet for the Facade to compute the backing buffer % filled
 * @custom:static-call - Use ethers callStatic() to get result after update; do not execute
 */
// slither-disable-start
contract BackingBufferFacet {
    using FixLib for uint192;

    // === Static Calls ===

    /// @return required {UoA} The required USD value of the backing buffer at current market caps
    /// @return actual {UoA} The actual USD value of the excess balances of the backing buffer
    /// @custom:static-call
    function backingBuffer(IRToken rToken) external returns (uint192 required, uint192 actual) {
        IMain main = rToken.main();
        IAssetRegistry reg = main.assetRegistry();
        OldBasketHandler bh = OldBasketHandler(address(main.basketHandler()));
        TestIBackingManager bm = TestIBackingManager(address(main.backingManager()));

        // Refresh AssetRegistry
        reg.refresh();

        // Read RToken state
        uint192 buffer = bm.backingBuffer(); // {1}
        uint192 basketsNeeded = rToken.basketsNeeded(); // {BU}
        uint192 buAvgPrice = _getAvgPrice(IAsset(address(bh))); // {UoA/BU}

        // Calculate `required`
        uint192 basketsInBuffer = basketsNeeded.mul(FIX_ONE + buffer, CEIL).minus(basketsNeeded);
        // {UoA} = {UoA/BU} * {BU}
        required = buAvgPrice.mul(basketsInBuffer, CEIL);

        // Calculate `actual`
        (address[] memory erc20s, ) = bh.quote(FIX_ONE, FLOOR);
        for (uint256 i = 0; i < erc20s.length; ++i) {
            IAsset asset = reg.toAsset(IERC20(erc20s[i]));

            // {tok} = {BU} * {tok/BU}
            uint192 req = basketsNeeded.mul(bh.quantity(IERC20(erc20s[i])), CEIL);
            uint192 bal = asset.bal(address(bm));

            // {UoA} = ({qTok} - {qTok}) * {UoA/tok}
            if (bal.gt(req)) actual += bal.minus(req).mul(_getAvgPrice(asset), CEIL);
        }
    }

    /// === Private ===

    /// Works for BasketHandler too
    /// @return {UoA/tok} or {UoA/BU} The average price of the asset or BasketHandler, in UoA
    function _getAvgPrice(IAsset asset) private view returns (uint192) {
        (uint192 low, uint192 high) = asset.price(); // will include issuance premium in 4.0.0
        if (low == 0 || high == FIX_MAX) return 0;
        return (low + high) / 2; // {UoA/tok}
    }
}
// slither-disable-end

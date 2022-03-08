// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/Asset.sol";
import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";

contract CompoundPricedAssetP0 is CompoundOracleMixinP0, AssetP0 {
    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        Fix maxAuctionSize_,
        IComptroller comptroller_
    ) CompoundOracleMixinP0(comptroller_) AssetP0(erc20_, maxAuctionSize_) {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (Fix) {
        return consultOracle(erc20);
    }

    function claimAdapter() external view virtual returns (IClaimAdapter) {
        return IClaimAdapter(address(0));
    }
}

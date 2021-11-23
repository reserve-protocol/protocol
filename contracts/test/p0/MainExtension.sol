// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/test/Mixins.sol";
import "contracts/test/p0/IExtension.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/MainP0.sol";
import "./RTokenExtension.sol";

/// Enables generic testing harness to set _msgSender() for Main.
contract MainExtension is IExtension, ContextMixin, MainP0 {
    constructor(
        address admin,
        Oracle.Info memory oracle_,
        Config memory config_
    ) ContextMixin(admin) MainP0(oracle_, config_) {}

    function checkInvariants() external override returns (bool) {
        return _INVARIANT_isFullyCapitalized() && _INVARIANT_tokensAndQuantitiesSameLength();
        // _INVARIANT_canAlwaysRedeemEverything();
    }

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }

    function _INVARIANT_isFullyCapitalized() internal view returns (bool) {
        return manager.fullyCapitalized();
    }

    function _INVARIANT_tokensAndQuantitiesSameLength() internal returns (bool) {
        return backingTokens().length == quote(1e18).length;
    }

    /// Redeems the entire outstanding RToken supply and re-issues it
    // function _INVARIANT_canAlwaysRedeemEverything() internal returns (bool) {
    //     RTokenExtension rToken = RTokenExtension(address(rTokenAsset.erc20()));
    //     uint256 supply = rToken.totalSupply();
    //     if (supply > 0) {
    //         SlowIssuance memory iss;
    //         iss.vault = manager.vault();
    //         iss.amount = supply;
    //         iss.BUs = manager.toBUs(supply);
    //         iss.issuer = address(this);
    //         iss.blockAvailableAt = block.number;

    //         rToken.adminMint(address(this), supply);
    //         manager.redeem(address(this), supply);

    //         address[] memory tokens = backingTokens();
    //         uint256[] memory quantities = quote(supply);
    //         for (uint256 i = 0; i < tokens.length; i++) {
    //             IERC20(tokens[i]).approve(address(manager.vault()), quantities[i]);
    //         }

    //         manager.vault().issue(address(this), iss.BUs);
    //         manager.vault().setAllowance(address(manager), iss.BUs);
    //         manager.issue(iss);
    //         rToken.burn(address(this), supply);
    //     }
    //     return true;
    // }
}

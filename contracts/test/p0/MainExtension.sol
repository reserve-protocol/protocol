// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/test/Mixins.sol";
import "contracts/mocks/ERC20Mock.sol";
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

    function issueInstantly(address account, uint256 amount) public {
        connect(account);
        issue(amount);
        issuances[issuances.length - 1].blockAvailableAt = block.number;
        _processSlowIssuance();
    }

    function assertInvariants() external override {
        _INVARIANT_isFullyCapitalized();
        _INVARIANT_tokensAndQuantitiesSameLength();
        _INVARIANT_canAlwaysRedeemEverything();
    }

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }

    function _INVARIANT_isFullyCapitalized() internal view {
        assert(manager.fullyCapitalized());
    }

    function _INVARIANT_tokensAndQuantitiesSameLength() internal {
        assert(backingTokens().length == quote(1e18).length);
    }

    /// Redeems the entire outstanding RToken supply and re-issues it
    function _INVARIANT_canAlwaysRedeemEverything() internal {
        RTokenExtension rToken = RTokenExtension(address(rTokenAsset.erc20()));
        uint256 supply = rToken.totalSupply();
        if (supply > 0) {
            rToken.adminMint(address(this), supply);
            connect(address(this));
            redeem(supply);

            address[] memory tokens = backingTokens();
            uint256[] memory quantities = quote(supply);
            for (uint256 i = 0; i < tokens.length; i++) {
                ERC20Mock(tokens[i]).adminApprove(address(this), address(this), quantities[i]);
            }

            issueInstantly(address(this), supply);
            rToken.burn(address(this), supply);
        }
        assert(true);
    }
}

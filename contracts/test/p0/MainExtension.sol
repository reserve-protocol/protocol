// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/test/Mixins.sol";
import "contracts/mocks/ERC20Mock.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/p0/MainP0.sol";
import "./RTokenExtension.sol";

/// Enables generic testing harness to set _msgSender() for Main.
contract MainExtension is IExtension, ContextMixin, MainP0 {
    using Address for address;
    using FixLib for Fix;

    constructor(
        address admin,
        Oracle.Info memory oracle,
        Config memory config
    ) ContextMixin(admin) MainP0(oracle, config) {}

    function issueInstantly(address account, uint256 amount) public {
        connect(account);
        issue(amount);
        issuances[issuances.length - 1].blockAvailableAt = block.number;
        _processSlowIssuance();
    }

    function assertInvariants() external override {
        _INVARIANT_stateDefined();
        _INVARIANT_configurationValid();
        _INVARIANT_isFullyCapitalized();
        _INVARIANT_nextRewardsInFutureOrNow();
        _INVARIANT_stateIsAmongEnum();
        _INVARIANT_quoteMonotonic();
        _INVARIANT_tokensAndQuantitiesSameLength();
        _INVARIANT_pricesDefinedForAllAssets();
        _INVARIANT_issuancesAreValid();
        _INVARIANT_canAlwaysRedeemEverything();
    }

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }

    function _INVARIANT_stateDefined() internal view {
        assert(address(_oracle.compound) != address(0));
        assert(address(_oracle.aave) != address(0));
        assert(address(furnace) != address(0));
        assert(address(stRSR) != address(0));
        assert(address(manager) != address(0));
        assert(address(monitor) != address(0));
        assert(address(rTokenAsset) != address(0));
        assert(address(rsrAsset) != address(0));
        assert(address(compAsset) != address(0));
        assert(address(aaveAsset) != address(0));
    }

    function _INVARIANT_configurationValid() internal view {
        assert(_config.rewardStart > 0);
        assert(_config.rewardPeriod > 0);
        assert(_config.auctionPeriod > 0);
        assert(_config.stRSRWithdrawalDelay > 0);
        assert(_config.defaultDelay > 0);

        assert(_config.maxTradeSlippage.gte(FIX_ZERO) && _config.maxTradeSlippage.lte(FIX_ONE));
        assert(_config.maxAuctionSize.gte(FIX_ZERO) && _config.maxAuctionSize.lte(FIX_ONE));
        assert(
            _config.minRecapitalizationAuctionSize.gte(FIX_ZERO) && _config.minRecapitalizationAuctionSize.lte(FIX_ONE)
        );
        assert(_config.minRevenueAuctionSize.gte(FIX_ZERO) && _config.minRevenueAuctionSize.lte(FIX_ONE));
        assert(_config.migrationChunk.gte(FIX_ZERO) && _config.migrationChunk.lte(FIX_ONE));
        assert(_config.issuanceRate.gte(FIX_ZERO) && _config.issuanceRate.lte(FIX_ONE));
        assert(_config.defaultThreshold.gte(FIX_ZERO) && _config.defaultThreshold.lte(FIX_ONE));
        assert(_config.f.gte(FIX_ZERO) && _config.f.lte(FIX_ONE));
    }

    function _INVARIANT_isFullyCapitalized() internal view {
        assert(manager.fullyCapitalized());
    }

    function _INVARIANT_nextRewardsInFutureOrNow() internal view {
        assert(nextRewards() >= block.timestamp);
    }

    function _INVARIANT_stateIsAmongEnum() internal view {
        assert(state == SystemState.CALM || state == SystemState.DOUBT || state == SystemState.TRADING);
    }

    function _INVARIANT_quoteMonotonic() internal view {
        bytes memory result = address(this).functionStaticCall(abi.encodeWithSignature("quote(uint256)", 1e18));
        uint256[] memory one = abi.decode(result, (uint256[]));
        bytes memory result2 = address(this).functionStaticCall(abi.encodeWithSignature("quote(uint256)", 1e18 + 1));
        uint256[] memory two = abi.decode(result2, (uint256[]));
        bytes memory result3 = address(this).functionStaticCall(abi.encodeWithSignature("quote(uint256)", 2e18));
        uint256[] memory three = abi.decode(result3, (uint256[]));
        assert(one.length == two.length);
        assert(two.length == three.length);
        for (uint256 i = 0; i < one.length; i++) {
            assert(one[i] <= two[i]);
            assert(two[i] <= three[i]);
        }
    }

    function _INVARIANT_tokensAndQuantitiesSameLength() internal view {
        bytes memory result = address(this).functionStaticCall(abi.encodeWithSignature("quote(uint256)", 1e18));
        uint256[] memory quantities = abi.decode(result, (uint256[]));
        assert(backingTokens().length == quantities.length);
    }

    function _INVARIANT_pricesDefinedForAllAssets() internal view {
        for (uint256 i = 0; i < manager.vault().size(); i++) {
            ICollateral c = manager.vault().collateralAt(i);
            assert(consultOracle(Oracle.Source.AAVE, address(c.erc20())).gt(FIX_ZERO));
        }
        assert(consultOracle(Oracle.Source.COMPOUND, address(compAsset.erc20())).gt(FIX_ZERO));
        assert(consultOracle(Oracle.Source.AAVE, address(rsrAsset.erc20())).gt(FIX_ZERO));
        assert(consultOracle(Oracle.Source.AAVE, address(aaveAsset.erc20())).gt(FIX_ZERO));
    }

    function _INVARIANT_issuancesAreValid() internal view {
        for (uint256 i = 0; i < issuances.length; i++) {
            if (issuances[i].processed && issuances[i].blockAvailableAt > block.number) {
                assert(false);
            }
        }
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

// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/interfaces/IAsset.sol";

import "./ProtoState.sol";
import "./Lib.sol";

interface ProtoCommon {
    /// Deploys a fresh instance of the system
    function init(ProtoState memory state) external;

    /// Updates oracle prices
    /// @param assets One-of DAI/USDC/UoAT/BUoA/RSR/COMP/AAVE
    function setBaseAssetPrices(AssetName[] memory assets, Price[] memory prices) external;

    /// Updates DeFi redemption rates
    /// @param defiAssets CTokens and ATokens
    function setDefiCollateralRates(
        AssetName[] memory defiAssets,
        Fix[] memory fiatcoinRedemptionRates
    ) external;

    function state() external view returns (ProtoState memory);

    function matches(ProtoState memory state) external view returns (bool);

    // ==== COMMANDS ====

    function CMD_issue(Account account, uint256 amount) external;

    function CMD_redeem(Account account, uint256 amount) external;

    function CMD_poke() external;

    function CMD_stakeRSR(Account account, uint256 amount) external;

    function CMD_unstakeRSR(Account account, uint256 amount) external;

    function CMD_setRTokenForMelting(uint256 amount) external;

    function CMD_transferRToken(
        Account from,
        Account to,
        uint256 amount
    ) external;

    function CMD_transferStRSR(
        Account from,
        Account to,
        uint256 amount
    ) external;
}

interface ProtoAdapter is ProtoCommon {
    function assertInvariants() external;
}

/// A single point of contact for the TS testing suite that ensures all provided impls stay in sync and
/// that their invariants are maintained.
contract ProtosDriver is ProtoCommon {
    using Lib for ProtoState;

    ProtoAdapter[] internal _adapters;

    constructor(address[] memory adapters) {
        for (uint256 i = 0; i < adapters.length; i++) {
            _adapters.push(ProtoAdapter(adapters[i]));
        }
        assert(_adapters.length > 0);
    }

    modifier afterCMD() {
        _;
        // Assert invariants
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].assertInvariants();
        }

        // Compare parallel implementations for equality
        for (uint256 i = 0; i < _adapters.length - 1; i++) {
            _adapters[i].state().assertEq(_adapters[i + 1].state());
        }
    }

    function init(ProtoState memory s) external override afterCMD {
        require(
            s.collateral.length == s.defiCollateralRates.length,
            "all collateral should have defi rates"
        );
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].init(s);
        }
    }

    /// @param baseAssets One-of DAI/USDC/UoAT/BUoA/RSR/COMP/AAVE
    function setBaseAssetPrices(AssetName[] memory baseAssets, Price[] memory prices)
        external
        override
    {
        require(baseAssets.length == prices.length, "baseAssets len mismatch prices");
        for (uint256 i = 0; i < _adapters.length; i++) {
            require(
                uint256(baseAssets[i]) <= 3 ||
                    ((uint256(baseAssets[i])) >= 11 && uint256(baseAssets[i]) <= 13),
                "fiatcoins + gov tokens only"
            );
            _adapters[i].setBaseAssetPrices(baseAssets, prices);
        }
    }

    /// @param defiCollateral CTokens and ATokens
    function setDefiCollateralRates(
        AssetName[] memory defiCollateral,
        Fix[] memory fiatcoinRedemptionRates
    ) external override {
        require(
            defiCollateral.length == fiatcoinRedemptionRates.length,
            "defiCollateral len mismatch fiatcoin redemption rate"
        );
        for (uint256 i = 0; i < _adapters.length; i++) {
            require(
                uint256(defiCollateral[i]) >= 4 && uint256(defiCollateral[i]) <= 10,
                "cToken/aTokens only"
            );
            _adapters[i].setDefiCollateralRates(defiCollateral, fiatcoinRedemptionRates);
        }
    }

    /// @return The first state, since txs only succeed if states match at end of tx
    function state() external view override returns (ProtoState memory) {
        return _adapters[0].state();
    }

    /// @return Whether the state of the synced simulations matches
    function matches(ProtoState memory s) external view override returns (bool) {
        return _adapters[0].matches(s);
    }

    // ==== COMMANDS ====

    function CMD_issue(Account account, uint256 amount) external override afterCMD {
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].CMD_issue(account, amount);
        }
    }

    function CMD_redeem(Account account, uint256 amount) external override afterCMD {
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].CMD_redeem(account, amount);
        }
    }

    function CMD_poke() external virtual override afterCMD {
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].CMD_poke();
        }
    }

    function CMD_stakeRSR(Account account, uint256 amount) external override afterCMD {
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].CMD_stakeRSR(account, amount);
        }
    }

    function CMD_unstakeRSR(Account account, uint256 amount) external override afterCMD {
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].CMD_unstakeRSR(account, amount);
        }
    }

    function CMD_setRTokenForMelting(uint256 amount) external override afterCMD {
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].CMD_setRTokenForMelting(amount);
        }
    }

    function CMD_transferRToken(
        Account from,
        Account to,
        uint256 amount
    ) external override afterCMD {
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].CMD_transferRToken(from, to, amount);
        }
    }

    function CMD_transferStRSR(
        Account from,
        Account to,
        uint256 amount
    ) external override afterCMD {
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].CMD_transferStRSR(from, to, amount);
        }
    }
}

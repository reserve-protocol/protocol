// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/interfaces/IAsset.sol";

import "./ProtoState.sol";
import "./Lib.sol";

interface ProtoCommon {
    /// Deploys a fresh instance of the system
    function init(ProtoState memory state) external;

    function state() external view returns (ProtoState memory);

    function assertEq(ProtoState memory state) external view;

    // ==== COMMANDS ====

    function CMD_issue(Account account, uint256 amount) external;

    function CMD_redeem(Account account, uint256 amount) external;

    function CMD_poke() external;

    function CMD_stakeRSR(Account account, uint256 amount) external;

    function CMD_unstakeRSR(Account account, uint256 amount) external;

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
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].init(s);
        }
    }

    /// @return The first state, since txs only succeed if states match at end of tx
    function state() external view override returns (ProtoState memory) {
        return _adapters[0].state();
    }

    function assertEq(ProtoState memory s) external view override {
        _adapters[0].assertEq(s);
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

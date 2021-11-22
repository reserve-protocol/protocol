// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./ProtoState.sol";
import "./Lib.sol";

interface ProtoCommon {
    function init(ProtoState memory state) external;

    /// @dev view
    function state() external returns (ProtoState memory);

    /// @dev view
    function matches(ProtoState memory state) external returns (bool);

    // ==== COMMANDS ====

    function CMD_issue(Account account, uint256 amount) external;

    function CMD_redeem(Account account, uint256 amount) external;

    function CMD_checkForDefault() external;

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
    function checkInvariants() external returns (bool);
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
        for (uint256 i = 0; i < _adapters.length - 1; i++) {
            assert(_adapters[i].state().eq(_adapters[i + 1].state()));
        }
        assert(_checkInvariants());
    }

    function init(ProtoState memory s) external override afterCMD {
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].init(s);
        }
    }

    /// @return The first state, since txs only succeed if states match at end of tx
    function state() external override returns (ProtoState memory) {
        return _adapters[0].state();
    }

    /// @return Whether the state of the synced simulations matches
    function matches(ProtoState memory s) external override returns (bool) {
        return _adapters[0].matches(s);
    }

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

    function CMD_checkForDefault() external override afterCMD {
        for (uint256 i = 0; i < _adapters.length; i++) {
            _adapters[i].CMD_checkForDefault();
        }
    }

    function CMD_poke() external override afterCMD {
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

    /// @return Whether all adapters are meeting their invariants
    function _checkInvariants() internal returns (bool) {
        for (uint256 i = 0; i < _adapters.length; i++) {
            if (!_adapters[i].checkInvariants()) {
                console.log("Adapter %s invariant violation", i);
                return false;
            }
        }
        return true;
    }
}

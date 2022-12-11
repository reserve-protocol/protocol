// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "../../interfaces/IMain.sol";
import "../../mixins/Versioned.sol";

/**
 * Abstract superclass for system contracts registered in Main
 */
abstract contract ComponentP0 is Versioned, Initializable, ContextUpgradeable, IComponent {
    IMain public main;

    // Sets main for the component - Can only be called during initialization
    // solhint-disable-next-line func-name-mixedcase
    function __Component_init(IMain main_) internal onlyInitializing {
        require(address(main_) != address(0), "main is zero address");
        main = main_;
    }

    // === See docs/security.md ===

    modifier notPausedOrFrozen() {
        require(!main.pausedOrFrozen(), "paused or frozen");
        _;
    }
    modifier notFrozen() {
        require(!main.frozen(), "frozen");
        _;
    }

    modifier governance() {
        require(main.hasRole(OWNER, _msgSender()), "governance only");
        _;
    }
}

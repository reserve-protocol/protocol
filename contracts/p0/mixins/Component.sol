// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "contracts/interfaces/IMain.sol";

/**
 * Abstract superclass for system contracts registered in Main
 */
abstract contract ComponentP0 is Initializable, ContextUpgradeable, IComponent {
    IMain public main;

    // Sets main for the component - Can only be called during initialization
    // solhint-disable-next-line func-name-mixedcase
    function __Component_init(IMain main_) internal onlyInitializing {
        main = main_;
    }

    modifier onlyOwner() {
        require(main.owner() == _msgSender(), "previous caller is not the owner");
        _;
    }

    modifier notPaused() {
        require(!main.paused(), "paused");
        _;
    }

    // === See docs/security.md ===
    // In P0 we do not apply locks

    modifier action() {
        main.beginActionTx();
        _;
        main.endTx();
    }

    modifier governance() {
        main.beginGovernanceTx(_msgSender());
        _;
        main.endTx();
    }

    modifier subroutine() {
        main.beginSubroutine();
        _;
    }
}

// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "contracts/interfaces/IComponent.sol";
import "contracts/interfaces/IMain.sol";

/**
 * Abstract superclass for system contracts registered in Main
 */
abstract contract ComponentP1 is Initializable, ContextUpgradeable, UUPSUpgradeable, IComponent {
    IMain public main;

    /// @custom:oz-upgrades-unsafe-allow constructor
    // solhint-disable-next-line no-empty-blocks
    constructor() initializer {}

    // Sets main for the component - Can only be called during initialization
    // solhint-disable-next-line func-name-mixedcase
    function __Component_init(IMain main_) internal onlyInitializing {
        __UUPSUpgradeable_init();
        main = main_;
    }

    // === See docs/security.md ===
    modifier interaction() {
        require(!main.paused(), "paused");
        _;
    }

    modifier governance() {
        require(main.owner() == _msgSender(), "unpaused or by owner");
        _;
    }

    modifier notPaused() {
        require(!main.paused(), "paused");
        _;
    }

    // solhint-disable-next-line no-empty-blocks
    function _authorizeUpgrade(address newImplementation) internal view override governance {}
}
